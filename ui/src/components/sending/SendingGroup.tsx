import { useState } from "react"
import { SAID, SettingsGroup } from "@/components/SettingsGroup"
import { PickRow } from "@/components/ui/pick-row"
import { BandServicePanel } from "@/components/sending/BandServicePanel"
import { CLOUD_HINT, CloudFolderPanel } from "@/components/sending/CloudFolderPanel"
import { ServiceKeyLine } from "@/components/sending/ServiceKeyLine"
import { dismiss, notify } from "@/lib/notices"
import { api, type SendTo, type Settings } from "@/lib/api"

const PLACES: { value: SendTo; label: string }[] = [
  { value: "cloud", label: "Cloud folder" },
  { value: "service", label: "Band service" },
]

/**
 * Where takes are sent, in Settings › Folders. With no band service key it
 * is the group Cloud folder, as it always was, with a quiet line at its
 * bottom for a key. With one it is Sending takes: the switch Send takes to,
 * and under it only the chosen place's panel, each with its own settings.
 */
export function SendingGroup({
  rise,
  settings,
  onSettings,
}: {
  rise: number
  settings: Settings | null
  onSettings: (s: Settings) => void
}) {
  // The key was kept without the service answering: said until Settings is
  // opened again, which asks no one.
  const [unchecked, setUnchecked] = useState(false)
  // The cloud folder's field starts from the setting, so it is drawn again
  // once the settings are read.
  const cloud = (
    <CloudFolderPanel
      key={settings ? "read" : "waiting"}
      settings={settings}
      onSettings={onSettings}
    />
  )

  if (!settings?.service) {
    return (
      <SettingsGroup rise={rise} title="Cloud folder" hint={CLOUD_HINT}>
        {cloud}
        {settings && (
          <ServiceKeyLine
            onConnected={async (notChecked) => {
              setUnchecked(notChecked)
              onSettings(await api().get_settings())
            }}
          />
        )}
      </SettingsGroup>
    )
  }

  const pick = async (which: SendTo) => {
    dismiss(SAID)
    const res = await api().set_send_to(which)
    if (!res.ok) {
      notify({ key: SAID, kind: "error", text: res.error ?? "Could not save that" })
      return
    }
    onSettings(await api().get_settings())
  }

  return (
    <SettingsGroup
      rise={rise}
      title="Sending takes"
      hint="Where the takes you keep go: a cloud folder on this computer, or the band service. The switch picks where new takes go; what is on its way goes on."
    >
      <PickRow
        label="Send takes to"
        value={settings.send_to}
        options={PLACES}
        onChange={(which) => void pick(which)}
      />
      {settings.send_to === "service" ? (
        <BandServicePanel settings={settings} unchecked={unchecked} onSettings={onSettings} />
      ) : (
        <>
          <p className="-mb-3 text-sm text-muted-foreground">{CLOUD_HINT}</p>
          {cloud}
        </>
      )}
    </SettingsGroup>
  )
}
