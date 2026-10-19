import { useEffect, useId, useState } from "react"
import { CloudUpload, FolderOpen, RotateCcw } from "lucide-react"
import { Warning } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SAID, SettingsGroup } from "@/components/SettingsGroup"
import { PickRow } from "@/components/ui/pick-row"
import { useNoticesGoWithPage } from "@/hooks/useErrorNotice"
import { dismiss, notify } from "@/lib/notices"
import { loadLabels } from "@/lib/labels"
import { SHARE_OPTIONS } from "@/lib/share"
import { endEveryOffer, endedByPython, keptText } from "@/lib/trash"
import { api, type CloudFormat, type Settings, type ShareWhat } from "@/lib/api"

/**
 * Settings › Folders: where rehearsals are kept, how short a false start is,
 * and the cloud folder with what goes to it, a group each. It reads the
 * settings when it opens.
 */
export function FoldersSettings() {
  useNoticesGoWithPage(SAID)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [dir, setDir] = useState("")
  const [cloudDir, setCloudDir] = useState("")
  const [falseStart, setFalseStart] = useState("")
  // The false-start field's unit, which a screen reader says after its name.
  const unitId = useId()

  useEffect(() => {
    ;(async () => {
      const s = await api().get_settings()
      setSettings(s)
      setDir(s.recordings_dir)
      setCloudDir(s.cloud_dir ?? "")
      setFalseStart(String(s.false_start_sec))
    })()
  }, [])

  // Saved when the field is left. Python keeps it within 5 to 120, and the
  // field then says what was kept; left empty or not a number, it goes back.
  const applyFalseStart = async () => {
    if (!settings) return
    const seconds = Math.round(Number(falseStart))
    if (falseStart.trim() === "" || !Number.isFinite(seconds)) {
      setFalseStart(String(settings.false_start_sec))
      return
    }
    if (seconds === settings.false_start_sec) {
      setFalseStart(String(seconds))
      return
    }
    dismiss(SAID)
    const res = await api().set_false_start(seconds)
    if (!res.ok || res.false_start_sec === undefined) {
      notify({ key: SAID, kind: "error", text: res.error ?? "Could not save that" })
      setFalseStart(String(settings.false_start_sec))
      return
    }
    setFalseStart(String(res.false_start_sec))
    setSettings({ ...settings, false_start_sec: res.false_start_sec })
  }

  const applyDir = async (path: string) => {
    dismiss(SAID)
    const res = await api().set_recordings_dir(path)
    if (!res.ok) {
      notify({ key: SAID, kind: "error", text: res.error ?? "Could not use that folder" })
      return
    }
    setDir(res.recordings_dir ?? path)
    // Its path warning, and what the field is saved against, are the new
    // folder's.
    setSettings(await api().get_settings())
    // Another library: other labels.
    void loadLabels()
    notify({ key: SAID, kind: "done", text: "Folder saved" })
    switched(res)
  }

  // Removals waiting for their Undo in the old folder were ended before the
  // switch (`ended`), so their notices go, and so do the offers of any that
  // could not end: their Undo would ask the new folder. Those stay in the
  // old one, where nothing will look again, so they are named now, and the
  // warning stays until it is closed. The folder in use chosen again is no
  // switch (`same`): its offers stay.
  const switched = ({
    kept,
    ended,
    same,
  }: {
    kept?: string[]
    ended?: string[]
    same?: boolean
  }) => {
    if (same) return
    endedByPython(ended)
    endEveryOffer()
    if (kept?.length) notify({ key: "kept", kind: "warning", text: keptText(kept) })
  }

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

  const browse = async () => {
    dismiss(SAID)
    const res = await api().choose_recordings_dir()
    if (res.cancelled) return
    if (!res.ok) {
      notify({
        key: SAID,
        kind: "error",
        text: res.error ?? "Could not open the folder picker",
      })
      return
    }
    setDir(res.recordings_dir ?? dir)
    setSettings(await api().get_settings())
    // Another library: other labels.
    void loadLabels()
    notify({ key: SAID, kind: "done", text: "Folder saved" })
    switched(res)
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
      <SettingsGroup rise={1} title="Recordings folder" hint="Where everything is recorded to.">
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Input
              id="recordings-dir"
              aria-label="Recordings folder"
              value={dir}
              onChange={(e) => setDir(e.target.value)}
              onBlur={() => {
                if (settings && dir !== settings.recordings_dir) applyDir(dir)
              }}
              spellCheck={false}
              className="font-mono text-xs"
            />
            <Button
              variant="outline"
              onClick={browse}
              aria-label="Choose recordings folder"
              className="shrink-0"
            >
              <FolderOpen />
              Browse
            </Button>
          </div>

          {settings?.path_warning && <Warning>{settings.path_warning}</Warning>}

          {/* By the folder saved, not the one being typed, so it does not
              come and go under the cursor. */}
          {settings && settings.recordings_dir !== settings.default_recordings_dir && (
            <Button
              variant="ghost"
              size="row"
              className="self-start text-muted-foreground"
              onClick={() => applyDir(settings.default_recordings_dir)}
            >
              <RotateCcw />
              Back to the default folder
            </Button>
          )}
        </div>
      </SettingsGroup>

      <SettingsGroup
        rise={2}
        title="False starts"
        hint="A take this short, with no ★ and no marks, shows as a false start on the rehearsal screen and in History, where Clear false starts clears them all at once, with Undo."
      >
        <div className="flex items-center gap-2 text-sm">
          <Label htmlFor="false-start">Shorter than</Label>
          <Input
            id="false-start"
            type="number"
            min={5}
            max={120}
            step={1}
            value={falseStart}
            onChange={(e) => setFalseStart(e.target.value)}
            onBlur={() => void applyFalseStart()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void applyFalseStart()
            }}
            aria-describedby={unitId}
            className="tnum w-20"
          />
          <span id={unitId}>seconds</span>
        </div>
      </SettingsGroup>

      <SettingsGroup
        rise={3}
        title="Cloud folder"
        hint="Where the takes you pick out are copied. Point it at a Drive or Dropbox folder, not at the recordings folder, so only the takes worth keeping go up, one at a time."
      >
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
      </SettingsGroup>
    </>
  )
}
