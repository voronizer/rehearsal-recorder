import { useId, useState } from "react"
import { CloudUpload, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, type SendTo, type Take } from "@/lib/api"
import { falseStarts, starredToSend } from "@/lib/evening"
import { wentTo } from "@/lib/deletion"
import { notify } from "@/lib/notices"
import { endedByPython, offerUndo } from "@/lib/trash"
import { pollSoon } from "@/lib/activity"

/** Off, but still saying why under the mouse: a disabled button takes no
 *  pointer events, so its tip would never be shown. */
const OFF =
  "aria-disabled:cursor-default aria-disabled:opacity-50 aria-disabled:hover:bg-background " +
  "dark:aria-disabled:hover:bg-input/30"

/**
 * The evening's two buttons, over its takes: Send starred copies every ★
 * take not yet in the cloud folder, as Settings' What gets sent says, or
 * sends it to the band service when that is where takes go;
 * Clear false starts moves the takes too short to be anything to the Trash,
 * at once, with Undo. Each says how many it would act on, and when that is
 * none, why: in a tip under the mouse, and as the button's description for
 * a screen reader, which never sees the tip.
 *
 * The rehearsal screen and History both put it in the head of the overview's
 * group, so an evening sorted later looks and works as it did on the night.
 */
export function EveningActions({
  folder,
  takes,
  falseStartSec,
  cloudDir,
  sendTo = "cloud",
  waiting,
  onChanged,
  onDeleted,
}: {
  folder: string
  takes: Take[]
  falseStartSec: number
  cloudDir: string | null
  /** Where takes go: the band service needs no folder. */
  sendTo?: SendTo
  /** Takes waiting for the cloud folder, by number. */
  waiting?: Record<number, unknown>
  onChanged: () => void
  /** The takes cleared, for the screen to let go of in its player. */
  onDeleted: (takes: Take[]) => void
}) {
  const [sending, setSending] = useState(false)
  const [clearing, setClearing] = useState(false)
  const sendWhyId = useId()
  const clearWhyId = useId()

  const service = sendTo === "service"
  const toSend = starredToSend(takes, waiting, sendTo)
  const onTheWay = takes.some((t) => t.starred && t.take_number in (waiting ?? {}))
  const there = service ? "the band service" : "the cloud folder"
  const ready = service || Boolean(cloudDir)
  const sendWhy = !ready
    ? "Choose a cloud folder in Settings"
    : !takes.some((t) => t.starred)
      ? "No take has ★"
      : toSend.length > 0
        ? service
          ? "Send every ★ take to the band service"
          : "Copy every ★ take to the cloud folder, as set in Settings › Folders"
        : onTheWay
          ? `Every ★ take is in ${there} or on its way`
          : `Every ★ take is in ${there}`
  const sendOff = !ready || toSend.length === 0 || sending

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
    if (clearOff) return
    setClearing(true)
    try {
      const numbers = going.map((t) => t.take_number)
      const res = await api().delete_takes(folder, numbers)
      // What waited of these takes, a crop of one, Python has sent on.
      endedByPython(res.ended)
      if (!res.ok) {
        notify({
          key: "evening",
          kind: "error",
          text: res.error ?? "Could not clear the false starts",
        })
      } else {
        const gone = new Set(res.deleted ?? [])
        onDeleted(going.filter((t) => gone.has(t.take_number)))
        if (res.undo) {
          const n = gone.size
          offerUndo({
            text: wentTo(n === 1 ? "1 false start" : `${n} false starts`),
            token: res.undo,
            onUndone: () => onChanged(),
          })
        }
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

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="row"
            aria-disabled={sendOff || undefined}
            aria-describedby={sendWhyId}
            onClick={() => void send()}
            className={OFF}
          >
            <CloudUpload />
            Send starred
            {toSend.length > 0 && <span className="tnum text-muted-foreground">{toSend.length}</span>}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{sendWhy}</TooltipContent>
      </Tooltip>
      <span id={sendWhyId} className="sr-only">
        {sendWhy}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="row"
            aria-disabled={clearOff || undefined}
            aria-describedby={clearWhyId}
            onClick={() => void clear(starts)}
            className={OFF}
          >
            <Trash2 />
            Clear false starts
            {starts.length > 0 && <span className="tnum text-muted-foreground">{starts.length}</span>}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{clearWhy}</TooltipContent>
      </Tooltip>
      <span id={clearWhyId} className="sr-only">
        {clearWhy}
      </span>
    </>
  )
}
