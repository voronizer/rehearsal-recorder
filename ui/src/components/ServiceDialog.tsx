import { useEffect, useState } from "react"
import { CloudOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogButtons,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { api, type ServiceFile, type Take } from "@/lib/api"
import { trackUp } from "@/lib/sending"
import { dismiss } from "@/lib/notices"
import { useAfter } from "@/hooks/useAfter"
import { useErrorNotice } from "@/hooks/useErrorNotice"
import { useHeld } from "@/lib/held"
import { SPINNER_AFTER_MS } from "@/lib/playLook"

/** The notice slot for what the dialog could not do. */
const SERVICE = "service-take"

/**
 * A take in the band service, from its cloud button: each track with what
 * of it is up, and Remove from the band service, which puts it in the
 * service's trash. The take here stays as it is.
 */
export function ServiceDialog({
  take,
  folder,
  onOpenChange,
  onDone,
}: {
  take: Take | null
  folder: string
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const shown = useHeld<Take | null>(take, null)
  // The service's answer, kept with the take it is for: another take's
  // answer is no answer, so its rows wait for their own.
  const [answer, setAnswer] = useState<{ take: Take; files: ServiceFile[] } | null>(null)
  const files = shown && answer?.take === shown ? answer.files : null
  const [busy, setBusy] = useState(false)
  const removing = useAfter(busy, SPINNER_AFTER_MS)
  const failed = useErrorNotice(SERVICE)

  useEffect(() => {
    if (!take) return
    dismiss(SERVICE)
    let alive = true
    void api()
      .service_take(folder, take.take_number)
      .then((res) => {
        if (alive && res.ok) setAnswer({ take, files: res.files ?? [] })
      })
    return () => {
      alive = false
    }
  }, [take, folder])

  const remove = async () => {
    if (!take) return
    dismiss(SERVICE)
    setBusy(true)
    const res = await api().unshare_take(folder, take.take_number)
    setBusy(false)
    if (!res.ok) {
      failed(res.error ?? "Could not remove it from the band service")
      return
    }
    onDone()
    onOpenChange(false)
  }

  // The rows are the take's tracks from the start, their words coming when
  // the service's answer does, so nothing moves.
  const rows = (shown?.tracks ?? []).map((t) => ({
    name: t.name,
    up: files?.find((f) => f.name === t.name),
  }))

  return (
    <Dialog open={take !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>“{shown?.name ?? ""}” in the band service</DialogTitle>
          <DialogDescription>
            The band hears each track as MP3 and downloads the FLAC, as recorded.
          </DialogDescription>
        </DialogHeader>

        <ul className="flex flex-col divide-y rounded-lg border bg-background/50" data-service-tracks>
          {rows.map((row) => (
            <li key={row.name} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{row.name}</span>
              <span
                className={row.up ? "text-xs text-muted-foreground" : "invisible text-xs"}
                aria-hidden={row.up ? undefined : true}
              >
                {row.up ? trackUp(row.up) : "MP3 and FLAC"}
              </span>
            </li>
          ))}
        </ul>

        <DialogButtons
          cancel="Close"
          cancelDisabled={busy}
          aside={
            <Button
              variant="ghost"
              size="row"
              disabled={busy}
              onClick={() => void remove()}
              className="text-muted-foreground hover:text-destructive"
            >
              {removing ? <Spinner after={0} /> : <CloudOff />}
              Remove from the band service
            </Button>
          }
        />
      </DialogContent>
    </Dialog>
  )
}
