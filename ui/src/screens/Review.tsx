import { useState } from "react"
import { Check, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Shell, SpaceHint } from "@/components/Shell"
import { TakePlayer } from "@/components/TakePlayer"
import { useMultitrackPlayer } from "@/hooks/useMultitrackPlayer"
import { usePlayerKeys, useSpacebar } from "@/hooks/useSpacebar"
import { MarkerDialog } from "@/components/MarkerDialog"
import {
  api,
  type Marker,
  type MarkerKind,
  type PendingTake,
} from "@/lib/api"
import { formatMMSS } from "@/lib/format"

/**
 * Right after stopping: listen and decide the take's fate. Until it is saved
 * the files stay in the rehearsal's drafts folder.
 */
export function Review({
  take,
  rehearsalName,
  onKept,
  onDiscarded,
}: {
  take: PendingTake
  rehearsalName: string
  onKept: () => void
  onDiscarded: () => void
}) {
  // A new take is usually another go at the same song, so the name carries
  // over from the previous one with the counter bumped.
  const [name, setName] = useState(
    take.suggested_name ?? `Take ${take.take_number}`
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const player = useMultitrackPlayer(take.tracks, take.duration_sec)

  // Marks made here are held in memory until the take is saved: it has no
  // folder yet, so there is nowhere on disk to put them. They travel with
  // keep_take, and go away with the take if it is discarded.
  const [markers, setMarkers] = useState<Marker[]>([])
  const [editing, setEditing] = useState<Marker | null>(null)

  const addMarker = (at: number) => {
    const rounded = Math.round(at * 100) / 100
    const fresh: Marker = { at: rounded, kind: "note", note: "" }
    setMarkers((prev) =>
      [...prev.filter((m) => Math.abs(m.at - rounded) > 0.01), fresh].sort(
        (a, b) => a.at - b.at
      )
    )
    setEditing(fresh)
  }

  const saveMarker = (at: number, note: string, kind: MarkerKind) => {
    setMarkers((prev) =>
      prev.map((m) => (Math.abs(m.at - at) <= 0.01 ? { ...m, note, kind } : m))
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
      markers
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

  return (
    <Shell
      subtitle={`${rehearsalName} · ${formatMMSS(take.duration_sec)}`}
      title={`Take ${take.take_number} recorded`}
      footer={
        <div className="flex flex-col items-center gap-3">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={discard} disabled={busy}>
              <Trash2 />
              Discard
            </Button>
            <Button size="lg" onClick={keep} disabled={busy}>
              <Check />
              Save take
            </Button>
          </div>
          <SpaceHint>save take</SpaceHint>
        </div>
      }
    >
      {/* The player wants the width; the name field does not. */}
      <div className="flex w-full flex-col gap-6">
        <div className="flex max-w-xl flex-col gap-2">
          <Label htmlFor="take-name">Take name</Label>
          <Input
            id="take-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="A song title, for example"
            className="h-11 text-base"
          />
        </div>

        <TakePlayer
          player={player}
          markers={markers}
          onAddMarker={addMarker}
          onEditMarker={setEditing}
          onRemoveMarker={removeMarker}
        />
      </div>

      <MarkerDialog
        marker={editing}
        onOpenChange={(open) => !open && setEditing(null)}
        onSave={saveMarker}
        onDelete={removeMarker}
      />
    </Shell>
  )
}
