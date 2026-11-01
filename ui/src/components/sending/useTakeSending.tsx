import { useState, type ReactNode } from "react"
import { ServiceDialog } from "@/components/ServiceDialog"
import { ShareDialog } from "@/components/ShareDialog"
import { pollSoon } from "@/lib/activity"
import { api, type SendTo, type Take } from "@/lib/api"
import { dismiss, notify } from "@/lib/notices"
import { isIn } from "@/lib/sending"

/**
 * What a take's cloud button does, by where takes go. To the cloud folder:
 * the share dialog, as always. To the band service: a take not there yet is
 * sent at once, and one that is opens its dialog, with Remove. `folderOf`
 * says which rehearsal a take is in; `onDone` hears that one changed.
 */
export function useTakeSending<T extends Take>(
  sendTo: SendTo,
  folderOf: (take: T) => string,
  onDone: (take: T) => void
): { share: (take: T) => void; dialogs: ReactNode } {
  const [toShare, setToShare] = useState<T | null>(null)
  const [inService, setInService] = useState<T | null>(null)

  const sendNow = async (take: T) => {
    const folder = folderOf(take)
    const slot = `service:${folder}:${take.take_number}`
    dismiss(slot)
    const res = await api().share_take(folder, take.take_number, "mix")
    if (!res.ok) {
      notify({
        key: slot,
        kind: "error",
        text: `Could not send ${take.name}: ${res.error ?? "it was refused"}`,
      })
      return
    }
    // It goes in the background now: ask after it at once.
    pollSoon()
    onDone(take)
  }

  const share = (take: T) => {
    if (sendTo === "cloud") setToShare(take)
    else if (isIn(take, "service")) setInService(take)
    else void sendNow(take)
  }

  const dialogs = (
    <>
      <ShareDialog
        take={toShare}
        folder={toShare ? folderOf(toShare) : ""}
        onOpenChange={(open) => !open && setToShare(null)}
        onDone={() => toShare && onDone(toShare)}
      />
      <ServiceDialog
        take={inService}
        folder={inService ? folderOf(inService) : ""}
        onOpenChange={(open) => !open && setInService(null)}
        onDone={() => inService && onDone(inService)}
      />
    </>
  )

  return { share, dialogs }
}
