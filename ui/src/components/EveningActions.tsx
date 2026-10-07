import { useState } from "react"
import { CloudUpload, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { api, type Take } from "@/lib/api"
import { falseStarts, starredToSend } from "@/lib/evening"
import { formatMMSS } from "@/lib/format"
import { canBePutBack, goPlural, rehearsalCloudToo, trashName } from "@/lib/deletion"
import { notify } from "@/lib/notices"
import { pollSoon } from "@/lib/activity"

/** Off, but still saying why under the mouse: a disabled button takes no
 *  pointer events, so its title would never be read. */
const OFF =
  "aria-disabled:cursor-default aria-disabled:opacity-50 aria-disabled:hover:bg-background " +
  "dark:aria-disabled:hover:bg-input/30"

/**
 * The evening's two buttons, over its takes: Send starred copies every ★
 * take not yet in the cloud folder, as Settings' What gets published says;
 * Clear false starts moves the takes too short to be anything to the Trash,
 * after asking. Each says how many it would act on, and when that is none,
 * why, under the mouse.
 *
 * The rehearsal screen and History both put it in the overview's row of
 * figures, so an evening sorted later looks and works as it did on the night.
 */
export function EveningActions({
  folder,
  takes,
  falseStartSec,
  cloudDir,
  waiting,
  onChanged,
  onDeleted,
}: {
  folder: string
  takes: Take[]
  falseStartSec: number
  cloudDir: string | null
  /** Takes waiting for the cloud folder, by number. */
  waiting?: Record<number, unknown>
  onChanged: () => void
  /** The takes cleared, for the screen to let go of in its player. */
  onDeleted: (takes: Take[]) => void
}) {
  const [sending, setSending] = useState(false)
  const [clearing, setClearing] = useState(false)
  // The false starts as they were when asked about: what is confirmed is
  // what goes.
  const [asking, setAsking] = useState<Take[] | null>(null)

  const toSend = starredToSend(takes, waiting)
  const onTheWay = takes.some((t) => t.starred && t.take_number in (waiting ?? {}))
  const sendWhy = !cloudDir
    ? "Choose a cloud folder in Settings"
    : !takes.some((t) => t.starred)
      ? "No take has ★"
      : toSend.length > 0
        ? "Copy every ★ take to the cloud folder, as What gets published says"
        : onTheWay
          ? "Every ★ take is in the cloud folder or on its way"
          : "Every ★ take is in the cloud folder"
  const sendOff = !cloudDir || toSend.length === 0 || sending

  const starts = falseStarts(takes, falseStartSec)
  // While they are being moved, the count still has them.
  const clearOff = starts.length === 0 || clearing
  const clearWhy =
    starts.length > 0
      ? `Takes shorter than ${falseStartSec} s with no ★ and no marks`
      : `No take is shorter than ${falseStartSec} s without ★ or marks`

  const send = async () => {
    if (sendOff) return
    setSending(true)
    try {
      const res = await api().send_starred(folder)
      // The copies run in the background now: ask after them at once.
      pollSoon()
      const failed = res.ok ? (res.failed ?? []) : []
      if (!res.ok) {
        notify({ key: "evening", kind: "error", text: res.error ?? "Could not send the ★ takes" })
      } else if (failed.length > 0) {
        const first = takes.find((t) => t.take_number === failed[0].take_number)
        notify({
          key: "evening",
          kind: "error",
          text:
            failed.length === 1
              ? `Could not send ${first?.name ?? "a take"}: ${failed[0].error}`
              : `Could not send ${failed.length} of them: ${failed[0].error}`,
        })
      }
    } catch {
      notify({ key: "evening", kind: "error", text: "Could not send the ★ takes" })
    }
    setSending(false)
    onChanged()
  }

  const clear = async (going: Take[]) => {
    setClearing(true)
    try {
      const res = await api().delete_takes(
        folder,
        going.map((t) => t.take_number)
      )
      if (!res.ok) {
        notify({
          key: "evening",
          kind: "error",
          text: res.error ?? "Could not clear the false starts",
        })
      } else {
        const gone = new Set(res.deleted ?? [])
        onDeleted(going.filter((t) => gone.has(t.take_number)))
        const failed = res.failed ?? []
        if (failed.length > 0) {
          const first = going.find((t) => t.take_number === failed[0].take_number)
          notify({
            key: "evening",
            kind: "error",
            text:
              failed.length === 1
                ? `Could not move ${first?.name ?? "a take"}: ${failed[0].error}`
                : `Could not move ${failed.length} of them: ${failed[0].error}`,
          })
        }
      }
    } catch {
      notify({ key: "evening", kind: "error", text: "Could not clear the false starts" })
    }
    setClearing(false)
    onChanged()
  }

  const n = asking?.length ?? 0
  const inCloud = (asking ?? []).filter((t) => t.cloud?.mix || t.cloud?.tracks).length

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        aria-disabled={sendOff || undefined}
        title={sendWhy}
        onClick={() => void send()}
        className={OFF}
      >
        <CloudUpload />
        Send starred
        {toSend.length > 0 && <span className="tnum text-muted-foreground">{toSend.length}</span>}
      </Button>
      <Button
        variant="outline"
        size="sm"
        aria-disabled={clearOff || undefined}
        title={clearWhy}
        onClick={() => !clearOff && setAsking(starts)}
        className={OFF}
      >
        <Trash2 />
        Clear false starts
        {starts.length > 0 && <span className="tnum text-muted-foreground">{starts.length}</span>}
      </Button>

      <ConfirmDialog
        open={asking !== null}
        onOpenChange={(open) => !open && setAsking(null)}
        title={`Move ${n === 1 ? "1 false start" : `${n} false starts`} to ${trashName()}?`}
        description={
          <div className="flex flex-col gap-3">
            <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
              {(asking ?? []).map((t) => (
                <li key={t.take_number} className="flex items-baseline justify-between gap-4">
                  <span className="truncate text-foreground">{t.name}</span>
                  <span className="tnum shrink-0">{formatMMSS(t.duration_sec)}</span>
                </li>
              ))}
            </ul>
            <p>
              {`${n === 1 ? "The take and all its tracks" : "The takes and all their tracks"} ` +
                `${goPlural()}.${rehearsalCloudToo(inCloud, n)} ${canBePutBack(n > 1)}`}
            </p>
          </div>
        }
        confirmLabel={`Move to ${trashName()}`}
        onConfirm={() => {
          if (asking) void clear(asking)
          setAsking(null)
        }}
      />
    </>
  )
}
