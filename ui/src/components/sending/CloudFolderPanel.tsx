import { useState } from "react"
import { CloudUpload, RotateCcw } from "lucide-react"
import { Warning } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SAID } from "@/components/SettingsGroup"
import { PickRow } from "@/components/ui/pick-row"
import { dismiss, notify } from "@/lib/notices"
import { SHARE_OPTIONS } from "@/lib/share"
import { api, type CloudFormat, type Settings, type ShareWhat } from "@/lib/api"

/** What the cloud folder is for, under its group's title or the switch. */
export const CLOUD_HINT =
  "Where the takes you pick out are copied. Point it at a Drive or Dropbox folder, not at the recordings folder, so only the takes worth keeping go up, one at a time."

/**
 * The cloud folder's rows in Settings › Folders: the folder, what a copy is
 * written as, and whether takes go on their own and what of them. Each
 * change is saved at once and the settings read again (`onSettings`).
 * Drawn under the group "Cloud folder" with no band service key, and under
 * the switch in "Sending takes" with one.
 */
export function CloudFolderPanel({
  settings,
  onSettings,
}: {
  settings: Settings | null
  onSettings: (s: Settings) => void
}) {
  // The field is the person's until it is saved. It starts from the
  // setting: the group draws this panel again once the settings are read.
  const [cloudDir, setCloudDir] = useState(settings?.cloud_dir ?? "")
  const setSettings = onSettings

  const applyCloudDir = async (path: string) => {
    dismiss(SAID)
    const res = await api().set_cloud_dir(path)
    if (!res.ok) {
      notify({ key: SAID, kind: "error", text: res.error ?? "Could not use that folder" })
      return
    }
    setCloudDir(res.cloud_dir ?? path)
    setSettings(await api().get_settings())
    notify({ key: SAID, kind: "done", text: "Cloud folder saved" })
  }

  const browseCloud = async () => {
    dismiss(SAID)
    const res = await api().choose_cloud_dir()
    if (res.cancelled) return
    if (!res.ok) {
      notify({
        key: SAID,
        kind: "error",
        text: res.error ?? "Could not open the folder picker",
      })
      return
    }
    setCloudDir(res.cloud_dir ?? cloudDir)
    setSettings(await api().get_settings())
    notify({ key: SAID, kind: "done", text: "Cloud folder saved" })
  }

  const setFormat = async (format: CloudFormat) => {
    dismiss(SAID)
    const res = await api().set_cloud_format(format)
    if (!res.ok) {
      notify({ key: SAID, kind: "error", text: res.error ?? "Could not save that" })
      return
    }
    setSettings(await api().get_settings())
  }

  // Sending on its own, and what is sent, are one setting in Python: each
  // is saved with the other as it was.
  const setSending = async (on: boolean, what: ShareWhat) => {
    dismiss(SAID)
    const res = await api().set_auto_publish(on, what)
    if (!res.ok) {
      notify({ key: SAID, kind: "error", text: res.error ?? "Could not save that" })
      return
    }
    setSettings(await api().get_settings())
  }

  const format = settings?.cloud_formats.find((f) => f.id === settings.cloud_format)

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Input
            id="cloud-dir"
            aria-label="Cloud folder"
            value={cloudDir}
            onChange={(e) => setCloudDir(e.target.value)}
            onBlur={() => {
              if (settings && cloudDir !== (settings.cloud_dir ?? ""))
                applyCloudDir(cloudDir)
            }}
            placeholder="Not set, so nothing is copied anywhere"
            spellCheck={false}
            className="font-mono text-xs"
          />
          <Button
            variant="outline"
            onClick={browseCloud}
            aria-label="Choose cloud folder"
            className="shrink-0"
          >
            <CloudUpload />
            Browse
          </Button>
        </div>

        {settings?.cloud_dir && (
          <Button
            variant="ghost"
            size="row"
            className="self-start text-muted-foreground"
            onClick={async () => {
              await api().clear_cloud_dir()
              setCloudDir("")
              setSettings(await api().get_settings())
            }}
          >
            <RotateCcw />
            Forget the cloud folder
          </Button>
        )}
      </div>

      {/* The cloud folder is the gate. Without one there are no copies,
          so the questions below have no subject: what a copy is written
          as, whether it goes on its own, what of it goes. They are left
          out, and the field above says the whole of it, with its own
          Browse beside it. Greyed out they were dead rows and sentences
          about copies that cannot happen. */}
      {settings?.cloud_dir && (
        <>
          {/* What a copy is written as comes first, right under the
              folder: it holds whether or not anything goes on its own,
              since it is the format of the takes sent by hand too. Under
              the row, the word on the choice in force. */}
          <div className="flex flex-col gap-2">
            <PickRow
              label="Copies are written as"
              value={settings.cloud_format}
              options={settings.cloud_formats.map((f) => ({ value: f.id, label: f.label }))}
              onChange={(f) => void setFormat(f)}
            />
            {format && <p className="text-xs text-muted-foreground">{format.hint}</p>}
            {settings.encoder_hint && settings.cloud_format !== "wav" && (
              <Warning>{settings.encoder_hint}</Warning>
            )}
            {/* This is about every format, so it stands apart from the
                chosen one's words, where it would read as more of them. */}
            <p className="mt-2 text-xs text-muted-foreground">
              Only the copies are affected. What was recorded stays untouched
              WAV on disk: it is the one thing here that cannot be made again.
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <Checkbox
                id="auto-publish"
                checked={settings.auto_publish}
                onCheckedChange={(on) => void setSending(on === true, settings.auto_publish_what)}
              />
              <Label htmlFor="auto-publish">Send saved takes automatically</Label>
            </div>
            <p className="pl-7 text-xs text-muted-foreground">
              Every take you keep is copied to the cloud folder on its own,
              between takes rather than while one is recording.
            </p>
          </div>

          {/* What automatic sending sends, and what Send starred sends:
              live whenever there is a cloud folder, and choosing it leaves
              automatic sending as it was. The hint kept is the chosen
              one's: three of them, each under its choice, took most of
              the screen for a decision made once. */}
          <div className="flex flex-col gap-2">
            <PickRow
              label="What gets sent"
              value={settings.auto_publish_what}
              options={SHARE_OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
              onChange={(what) => void setSending(settings.auto_publish, what)}
            />
            <p className="text-xs text-muted-foreground">
              {SHARE_OPTIONS.find((o) => o.id === settings.auto_publish_what)?.hint}
            </p>
            {/* Send starred, over a rehearsal's takes, sends by hand what
                this says; its tooltip sends people here, and this says so
                back. */}
            <p className="text-xs text-muted-foreground">This is also what Send starred sends.</p>
          </div>
        </>
      )}
    </>
  )
}
