import { useEffect, useState } from "react"
import { Circle, FolderOpen, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Shell, SpaceHint } from "@/components/Shell"
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
  type SessionState,
  type Take,
} from "@/lib/api"
import { takesLabel } from "@/lib/format"
import { canBePutBack, goPlural } from "@/lib/deletion"

/**
 * The rehearsal hub: what has been recorded, and a big button to record more.
 * Any saved take plays right here, in the player below the strip of takes.
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
  const { selected, select, reselect, player } = useTakeStripPlayer()
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
  const [finishing, setFinishing] = useState(false)

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

  // With a take open, Space plays it back rather than starting a new one;
  // Escape below is what points Space at recording again.
  useSpacebar(selected ? player.toggle : startTake, !busy)
  usePlayerKeys(player.skip, selected !== null)
  // Escape climbs the same ladder here as everywhere: the open take first,
  // and then the rehearsal itself, because finishing is the only way up from
  // this screen. It asks once there are takes in the rehearsal — ending it by
  // accident would leave the rest of the evening in a second folder — but an
  // empty one has nothing to protect, and Python takes its folder with it.
  useEscape(() => {
    if (selected) select(null)
    else if (session.takes.length === 0) void finish()
    else setFinishing(true)
  }, !busy)

  // While takes are being copied the only thing that changes is on the Python
  // side, so ask — but only until the queue drains.
  const inFlight = Object.keys(session.cloud_queue ?? {}).length > 0
  useEffect(() => {
    if (!inFlight) return
    const id = setInterval(() => onChanged(), 1500)
    return () => clearInterval(id)
  }, [inFlight, onChanged])

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
    // paths. That is a new `tracks` identity, so the open effect underneath
    // tears down and reopens from zero — the take stays selected and on
    // screen, but playback and the A–B region do not survive this.
    if (selected?.take_number === take.take_number && res.take) reselect(res.take)
    onChanged()
  }

  // Python let go of the files before rewriting them, so the take has to be
  // opened again; the fresh `tracks` array is what tells the player that.
  // Rewriting eight long tracks takes real seconds, so the screen is busy
  // while it runs: a second Crop would cut the take the first one made.
  const cropTake = async (take: Take, from: number, to: number) => {
    if (busy) return
    setBusy(true)
    setError(null)
    player.pause()
    const res = await api().crop_take(session.folder, take.take_number, from, to)
    setBusy(false)
    if (!res.ok) {
      setError(res.error ?? "Could not crop the take")
      return
    }
    if (res.take) reselect(res.take)
    onChanged()
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
      <div className="flex w-full flex-col gap-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FolderOpen className="size-3.5 shrink-0" />
          <span className="truncate font-mono">{session.folder}</span>
        </div>

        <TakeStrip
          takes={session.takes}
          selected={selected}
          onSelect={select}
          onRename={setToRename}
          onShare={setToShare}
          onDelete={setToDelete}
          cloudStates={session.cloud_queue}
          emptyHint="Hit Record or press Space — takes show up here and can be played straight away."
        />

        {selected ? (
          <TakePlayer
            player={player}
            markers={liveTake(session.takes, selected)?.markers ?? []}
            onAddMarker={(sec) => addMarker(selected, sec)}
            onEditMarker={(marker) => setMarkerEdit({ take: selected, marker })}
            onRemoveMarker={(sec) => removeMarker(selected, sec)}
            onCrop={(from, to) => void cropTake(selected, from, to)}
            canCrop={!busy}
          />
        ) : (
          session.takes.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Pick a take to listen back to it.
            </p>
          )
        )}

        <p className="text-xs text-muted-foreground">
          Same tracks as at the start of the rehearsal:{" "}
          {session.tracks.map((t) => t.name).join(", ")}.
        </p>
      </div>

      <ConfirmDialog
        open={finishing}
        onOpenChange={setFinishing}
        title="Finish this rehearsal?"
        description={`${takesLabel(
          session.takes.length
        )} are saved and stay where they are. You cannot add to this rehearsal afterwards — a later one starts its own folder.`}
        confirmLabel="Finish"
        cancelLabel="Keep going"
        destructive={false}
        onConfirm={() => void finish()}
      />

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
