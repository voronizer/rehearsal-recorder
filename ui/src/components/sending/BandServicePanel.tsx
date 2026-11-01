import { Unplug } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { SAID } from "@/components/SettingsGroup"
import { dismiss, notify } from "@/lib/notices"
import { api, type Settings } from "@/lib/api"

/**
 * The band service's rows in Settings › Folders, under the switch in
 * Sending takes: where it is and Disconnect, what goes there, and its own
 * Send saved takes automatically. `unchecked`: the key was kept without the
 * service answering.
 */
export function BandServicePanel({
  settings,
  unchecked,
  onSettings,
}: {
  settings: Settings
  unchecked: boolean
  onSettings: (s: Settings) => void
}) {
  const service = settings.service
  if (!service) return null

  const disconnect = async () => {
    dismiss(SAID)
    const res = await api().disconnect_service()
    if (!res.ok) {
      notify({ key: SAID, kind: "error", text: res.error ?? "Could not disconnect" })
      return
    }
    onSettings(await api().get_settings())
  }

  const setAuto = async (on: boolean) => {
    dismiss(SAID)
    const res = await api().set_service_auto_publish(on)
    if (!res.ok) {
      notify({ key: SAID, kind: "error", text: res.error ?? "Could not save that" })
      return
    }
    onSettings(await api().get_settings())
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-xs" data-service-address>
            {service.address}
          </span>
          <Button variant="outline" size="row" className="shrink-0" onClick={() => void disconnect()}>
            <Unplug />
            Disconnect
          </Button>
        </div>
        {unchecked && (
          <p className="text-xs text-muted-foreground">
            Not checked yet: the band service could not be reached.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Every track goes up as MP3 to listen to and FLAC as recorded, with its notes as .mid and
          the take's marks.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <Checkbox
            id="service-auto-publish"
            checked={service.auto_publish}
            onCheckedChange={(on) => void setAuto(on === true)}
          />
          <Label htmlFor="service-auto-publish">Send saved takes automatically</Label>
        </div>
        <p className="pl-7 text-xs text-muted-foreground">
          Every take you keep goes to the band service on its own, between takes rather than while
          one is recording. False starts stay here.
        </p>
      </div>
    </>
  )
}
