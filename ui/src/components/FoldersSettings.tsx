import { useEffect, useId, useState } from "react"
import { FolderOpen, RotateCcw } from "lucide-react"
import { Warning } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SAID, SettingsGroup } from "@/components/SettingsGroup"
import { useNoticesGoWithPage } from "@/hooks/useErrorNotice"
import { dismiss, notify } from "@/lib/notices"
import { loadLabels } from "@/lib/labels"
import { endEveryOffer, endedByPython, keptText } from "@/lib/trash"
import { SendingGroup } from "@/components/sending/SendingGroup"
import { api, type Settings } from "@/lib/api"

/**
 * Settings › Folders: where rehearsals are kept, how short a false start is,
 * and where takes are sent (SendingGroup), a group each. It reads the
 * settings when it opens.
 */
export function FoldersSettings() {
  useNoticesGoWithPage(SAID)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [dir, setDir] = useState("")
  const [falseStart, setFalseStart] = useState("")
  // The false-start field's unit, which a screen reader says after its name.
  const unitId = useId()

  useEffect(() => {
    ;(async () => {
      const s = await api().get_settings()
      setSettings(s)
      setDir(s.recordings_dir)
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

      <SendingGroup rise={3} settings={settings} onSettings={setSettings} />
    </>
  )
}
