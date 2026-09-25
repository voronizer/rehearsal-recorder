import { useState } from "react"
import { LifeBuoy, Save, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Shell } from "@/components/Shell"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { api, type Draft } from "@/lib/api"
import { formatDateHuman, formatMMSS } from "@/lib/format"
import { canBePutBack, goesTo } from "@/lib/deletion"
import { dismiss, notify } from "@/lib/notices"

/**
 * Takes that were recorded but never saved — the app was closed or died
 * mid-take. Their audio is on disk as raw PCM, so nothing plays it yet; here
 * it can be turned into a normal take or thrown away.
 *
 * Shown on startup, before anything else, because ignoring it silently is how
 * a rehearsal gets lost.
 */
// What an action here said — one slot, so each says over the last.
const SAID = "drafts"

export function DraftsScreen({
  drafts,
  onDone,
}: {
  drafts: Draft[]
  onDone: () => void
}) {
  const [remaining, setRemaining] = useState(drafts)
  const [busy, setBusy] = useState<string | null>(null)
  const [toDiscard, setToDiscard] = useState<Draft | null>(null)

  const finish = (rest: Draft[]) => {
    setRemaining(rest)
    if (rest.length === 0) onDone()
  }

  const recover = async (draft: Draft) => {
    setBusy(draft.dir)
    dismiss(SAID)
    const res = await api().recover_draft(draft.dir)
    setBusy(null)
    if (!res.ok) {
      notify({ key: SAID, kind: "error", text: res.error ?? "Could not recover the take" })
      return
    }
    finish(remaining.filter((d) => d.dir !== draft.dir))
  }

  const discard = async (draft: Draft) => {
    setBusy(draft.dir)
    dismiss(SAID)
    const res = await api().discard_draft(draft.dir)
    setBusy(null)
    if (!res.ok) {
      notify({ key: SAID, kind: "error", text: res.error ?? "Could not discard the take" })
      return
    }
    finish(remaining.filter((d) => d.dir !== draft.dir))
  }

  return (
    <Shell
      title="Unsaved takes found"
      footer={
        <div className="flex flex-col items-center gap-2">
          <Button variant="ghost" onClick={onDone}>
            Decide later
          </Button>
          <p className="text-xs text-muted-foreground">
            They stay on disk and will be offered again next time.
          </p>
        </div>
      }
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div className="flex items-start gap-3 rounded-xl border border-warn/40 bg-warn/10 px-5 py-4 text-sm text-warn">
          <LifeBuoy className="mt-0.5 size-4 shrink-0" />
          <p>
            The app closed while these takes were still recording, so they were
            never saved. The audio is intact — recover a take to add it to its
            rehearsal.
          </p>
        </div>


        <div className="flex flex-col gap-2">
          {remaining.map((draft) => (
            <div
              key={draft.dir}
              className="flex items-center gap-4 rounded-xl border bg-card px-5 py-4"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {draft.rehearsal_name}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {formatDateHuman(draft.created_at)} · {draft.tracks.length}{" "}
                  {draft.tracks.length === 1 ? "track" : "tracks"} ·{" "}
                  <span className="tnum">{formatMMSS(draft.duration_sec)}</span>
                </div>
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => setToDiscard(draft)}
                disabled={busy !== null}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 />
                Discard
              </Button>
              <Button
                size="sm"
                onClick={() => recover(draft)}
                disabled={busy !== null}
              >
                <Save />
                Recover
              </Button>
            </div>
          ))}
        </div>
      </div>

      <ConfirmDialog
        open={toDiscard !== null}
        onOpenChange={(open) => !open && setToDiscard(null)}
        title="Discard this unsaved take?"
        description={`The recording ${goesTo()}. ${canBePutBack()}`}
        confirmLabel="Discard"
        onConfirm={() => {
          if (toDiscard) void discard(toDiscard)
          setToDiscard(null)
        }}
      />
    </Shell>
  )
}
