import { useEffect, useState } from "react"
import { Check, Cloud, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FooterRow } from "@/components/FooterRow"
import { Kbd, Shell } from "@/components/Shell"
import { RunningLine } from "@/components/RunningLine"
import { TakePlayer } from "@/components/TakePlayer"
import { TakeSummary } from "@/components/TakeSummary"
import { useMultitrackPlayer } from "@/hooks/useMultitrackPlayer"
import { useEscape, usePlayerKeys, useSpacebar } from "@/hooks/useSpacebar"
import { MarkerDialog } from "@/components/MarkerDialog"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { useSongChoices } from "@/hooks/useSongChoices"
import { canBePutBack, goesTo } from "@/lib/deletion"
import {
  api,
  type Marker,
  type PendingTake,
  type ShareWhat,
  type Take,
} from "@/lib/api"
import { croppedButNotSwept, formatMMSS } from "@/lib/format"
import { dismiss, notify } from "@/lib/notices"
import { useRunning, watching } from "@/lib/activity"
import { useLabels } from "@/lib/labels"

/**
 * Right after stopping: listen and decide the take's fate. Until it is saved
 * the files stay in the rehearsal's drafts folder.
 */
/** How the review screen names what the cloud copy of a take will be. */
const WHAT_GOES: Record<ShareWhat, string> = {
  mix: "the mix",
  tracks: "the original tracks",
  both: "the mix and the tracks",
}

export function Review({
  take,
  rehearsalName,
  takes,
  onKept,
  onDiscarded,
  onCropped,
}: {
  take: PendingTake
  rehearsalName: string
  /** Tonight's takes kept so far: the song's goes before this one. */
  takes: Take[]
  onKept: () => void
  onDiscarded: () => void
  onCropped: (take: PendingTake) => void
}) {
  // A new take is usually another go at the same song, so the name carries
  // over from the previous one with the counter bumped.
  const firstName = take.suggested_name ?? `Take ${take.take_number}`
  const [name, setName] = useState(firstName)
  // And when the band has moved on, the song they moved to is a click, in
  // Rename take.
  const songChoices = useSongChoices(true, null, take.take_number)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const player = useMultitrackPlayer(take.tracks, take.duration_sec)
  const cropping = useRunning("crop", (e) => e.folder === take.temp_dir)

  // Marks made here are held in memory until the take is saved: it has no
  // folder yet, so there is nowhere on disk to put them. They travel with
  // keep_take, and go away with the take if it is discarded.
  const [markers, setMarkers] = useState<Marker[]>([])
  const labels = useLabels()

  // Whether this take goes to the cloud folder, said before it is saved and
  // turnable for this one take: a false start kept anyway need not go up,
  // and the one good take can, with sending off. It starts from the setting
  // every time — a choice made for one take is not a new setting.
  const [cloud, setCloud] = useState<{
    dir: string | null
    auto: boolean
    what: ShareWhat
    format: string
  } | null>(null)
  const [send, setSend] = useState(false)
  useEffect(() => {
    let alive = true
    void api()
      .get_settings()
      .then((s) => {
        if (!alive) return
        setCloud({
          dir: s.cloud_dir,
          auto: s.auto_publish,
          what: s.auto_publish_what,
          format: s.cloud_format,
        })
        setSend(Boolean(s.cloud_dir) && s.auto_publish)
      })
      .catch(() => {
        /* the bar has said so; the take still saves by the setting */
      })
    return () => {
      alive = false
    }
  }, [])
  const [editing, setEditing] = useState<Marker | null>(null)

  // This screen is a fork — save or give up — so Escape, which everywhere else
  // means one level up, has only the one way out to offer. It asks first: the
  // take was played seconds ago and cannot be played again, and a key pressed
  // by accident is exactly what a confirmation is for. The Discard button does
  // not ask, because pressing a labelled button is not an accident.
  const [discarding, setDiscarding] = useState(false)
  useEscape(() => setDiscarding(true), !busy)

  const addMarker = (at: number) => {
    const rounded = Math.round(at * 100) / 100
    // Python gives the first label too, but this take has no folder yet and
    // its marks are held here until Save take.
    const fresh: Marker = { at: rounded, label_id: labels[0]?.id ?? 0, note: "" }
    setMarkers((prev) =>
      [...prev.filter((m) => Math.abs(m.at - rounded) > 0.01), fresh].sort(
        (a, b) => a.at - b.at
      )
    )
    setEditing(fresh)
  }

  const saveMarker = (at: number, note: string, labelId: number) => {
    setMarkers((prev) =>
      prev.map((m) => (Math.abs(m.at - at) <= 0.01 ? { ...m, note, label_id: labelId } : m))
    )
  }

  const removeMarker = (at: number) => {
    setMarkers((prev) => prev.filter((m) => Math.abs(m.at - at) > 0.01))
  }

  usePlayerKeys(player.skip, !busy)

  const keep = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    player.pause()
    const res = await api().keep_take(
      take.take_number,
      take.temp_dir,
      name,
      take.duration_sec,
      take.tracks,
      markers,
      // Only an answer that differs from the setting is sent: one that
      // agrees leaves the take following the setting, even if it changes.
      cloud?.dir && send !== cloud.auto ? send : null,
      // The .mid files stop_take made, kept beside the audio.
      take.notes
    )
    setBusy(false)
    if (!res.ok) {
      setError(res.error ?? "Could not save the take")
      return
    }
    onKept()
  }

  // Declared after keep, because that is what it runs.
  useSpacebar(keep, !busy)

  const discard = async () => {
    if (busy) return
    setBusy(true)
    player.pause()
    await api().discard_take(take.temp_dir)
    setBusy(false)
    onDiscarded()
  }

  // The markers here are held in memory — the take has no folder on disk yet —
  // so they move with the audio by hand rather than coming back from Python.
  const cropDraft = async (from: number, to: number) => {
    if (busy) return
    setBusy(true)
    setError(null)
    dismiss("review")
    player.pause()
    const res = await watching(
      api().crop_draft(take.temp_dir, take.tracks, from, to, take.notes)
    )
    setBusy(false)
    if (!res.ok) {
      setError(res.error ?? "Could not crop the take")
      return
    }
    setMarkers((prev) =>
      prev
        .filter((m) => m.at >= from && m.at <= to)
        .map((m) => ({ ...m, at: Math.round((m.at - from) * 100) / 100 }))
    )
    // The notes are cut with the audio. A new list is a take opened again:
    // the player reads them afresh.
    onCropped({
      ...take,
      tracks: res.tracks ?? take.tracks,
      notes: res.notes ?? take.notes,
      duration_sec: res.duration_sec ?? take.duration_sec,
    })
    // The crop itself went through — only the sweep of the original is what
    // failed — so this adds to the success path rather than standing in for it.
    if (res.error) {
      notify({
        key: "review",
        kind: "warning",
        text: croppedButNotSwept(res.error, res.location),
      })
    }
  }

  return (
    <Shell
      playback
      subtitle={`${rehearsalName} · ${formatMMSS(take.duration_sec)}`}
      title={`Take ${take.take_number} recorded`}
      footer={
        <FooterRow
          error={error}
          rule
          left={
            <TakeSummary
              name={name}
              takeNumber={take.take_number}
              durationSec={take.duration_sec}
              takes={takes}
              choices={songChoices}
              fallback={take.default_name ?? `Take ${take.take_number}`}
              onRename={setName}
            />
          }
        >
          <div className="flex items-center gap-3">
            {/* Escape asks before discarding; the button itself does not.
                It is still the button Escape leads to. */}
            <Button
              variant="outline"
              size="lg"
              onClick={discard}
              disabled={busy}
              aria-keyshortcuts="Escape"
            >
              <Trash2 />
              Discard
              <Kbd>Esc</Kbd>
            </Button>
            <Button
              size="lg"
              onClick={keep}
              disabled={busy}
              aria-keyshortcuts="Space"
            >
              <Check />
              Save take
              <Kbd>Space</Kbd>
            </Button>
          </div>
          {cloud &&
            (cloud.dir ? (
              <label
                htmlFor="send-to-cloud"
                className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground"
              >
                <input
                  id="send-to-cloud"
                  type="checkbox"
                  checked={send}
                  onChange={(e) => {
                    setSend(e.target.checked)
                    // Focus left on the box would give it the next Space,
                    // which on this screen means Save take.
                    e.currentTarget.blur()
                  }}
                  disabled={busy}
                  className="size-4 accent-primary"
                />
                <Cloud className="size-4" />
                Send to the cloud — {WHAT_GOES[cloud.what]},{" "}
                {cloud.format.toUpperCase()}
              </label>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Cloud className="size-4" />
                Stays on this computer — no cloud folder is set
              </p>
            ))}
        </FooterRow>
      }
    >
      <div className="flex w-full flex-col gap-6">
        <TakePlayer
          player={player}
          notes={take.notes}
          notesMissing={take.notes_missing}
          markers={markers}
          onAddMarker={addMarker}
          onEditMarker={setEditing}
          onRemoveMarker={removeMarker}
          onCrop={(from, to) => void cropDraft(from, to)}
          canCrop={!busy}
          status={<RunningLine entry={cropping} label="Cropping" />}
        />
      </div>

      <MarkerDialog
        marker={editing}
        onOpenChange={(open) => !open && setEditing(null)}
        onSave={saveMarker}
        onDelete={removeMarker}
      />

      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title="Discard this take?"
        description={`The recording ${goesTo()}. ${canBePutBack()}`}
        confirmLabel="Discard"
        cancelLabel="Keep it"
        onConfirm={discard}
      />
    </Shell>
  )
}
