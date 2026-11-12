import { useEffect, useState, type ReactNode } from "react"
import { CloudOff, CloudUpload, FolderOpen, Layers, Music4, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group"
import {
  Dialog,
  DialogButtons,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { ShareOption } from "@/components/ShareOption"
import { api, type ShareWhat, type Take } from "@/lib/api"
import { pollSoon } from "@/lib/activity"
import { dismiss } from "@/lib/notices"
import { SHARE_INTRO, SHARE_OPTIONS } from "@/lib/share"
import { takeText } from "@/lib/takeText"
import { reloadEveningSettings } from "@/hooks/useEveningSettings"
import { useAfter } from "@/hooks/useAfter"
import { useErrorNotice } from "@/hooks/useErrorNotice"
import { useHeld } from "@/lib/held"
import { SPINNER_AFTER_MS } from "@/lib/playLook"

/** The notice slot for what the dialog could not do. */
const SHARE = "share"

const ICONS: Record<ShareWhat, ReactNode> = {
  mix: <Music4 />,
  tracks: <Layers />,
  both: <CloudUpload />,
}

/**
 * Putting one take into the cloud folder.
 *
 * Copying everything would mean syncing every failed attempt, which is most of
 * a rehearsal. So it is done here, per take, after listening, and with a
 * choice: the mix is what gets sent to people, the original tracks are what
 * someone opens in a DAW later.
 *
 * What it could not do is said in an error notice (C4), over the veil, and
 * the dialog stays to try again from.
 */
export function ShareDialog({
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
  // The cloud folder, null when none is set, and undefined until the
  // setting is read: then the line says nothing either way.
  const [cloudDir, setCloudDir] = useState<string | null | undefined>(undefined)
  const none = cloudDir === null
  const [busy, setBusy] = useState<ShareWhat | "remove" | null>(null)
  const failed = useErrorNotice(SHARE)
  // Remove keeps its icon for the first second of a removal (B5).
  const removing = useAfter(busy === "remove", SPINNER_AFTER_MS)

  // The take the dialog names, until it has faded out.
  const shown = useHeld<Take | null>(take, null)
  const shared = shown?.cloud ?? {}
  const isShared = Boolean(shared.mix || shared.tracks)

  useEffect(() => {
    if (!take) return
    dismiss(SHARE)
    void api()
      .get_settings()
      .then((s) => setCloudDir(s.cloud_dir))
  }, [take])

  const pickFolder = async () => {
    dismiss(SHARE)
    const res = await api().choose_cloud_dir()
    if (res.cancelled) return
    if (!res.ok) {
      failed(res.error ?? "Could not open the folder picker")
      return
    }
    setCloudDir(res.cloud_dir ?? null)
    // Send starred, over the takes, goes by it too.
    void reloadEveningSettings()
  }

  const share = async (what: ShareWhat) => {
    if (!take) return
    dismiss(SHARE)
    setBusy(what)
    const res = await api().share_take(folder, take.take_number, what)
    setBusy(null)
    if (!res.ok) {
      failed(res.error ?? "Could not copy the take")
      return
    }
    // The copy runs in the background now and can be over in a fraction of
    // a second; ask at once so its result is not missed.
    pollSoon()
    onDone()
    onOpenChange(false)
  }

  const remove = async () => {
    if (!take) return
    dismiss(SHARE)
    setBusy("remove")
    const res = await api().unshare_take(folder, take.take_number)
    setBusy(null)
    if (!res.ok) {
      failed(res.error ?? "Could not remove the copies")
      return
    }
    onDone()
    onOpenChange(false)
  }

  // Each option is there when every copy it makes is.
  const there: Record<ShareWhat, boolean> = {
    mix: Boolean(shared.mix),
    tracks: Boolean(shared.tracks),
    both: Boolean(shared.mix && shared.tracks),
  }

  return (
    <Dialog open={take !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy “{shown ? takeText(shown) : ""}” to the cloud</DialogTitle>
          <DialogDescription>{SHARE_INTRO}</DialogDescription>
        </DialogHeader>

        {/* The folder and its button in one frame, one control, as tall
            as the row was with the button inside it. With no folder, the
            shared warning look: the triangle in the warn colour and the
            words in the text's own. Until the setting is read, the folder's
            icon and nothing else, with the button's room kept, so a folder
            that is set never shows as missing. In the dark theme the path
            takes the outline button's fill and edge, as a field does. Named
            "Cloud folder", as the path alone does not say what it is. */}
        <ButtonGroup aria-label="Cloud folder" className="w-full">
          <ButtonGroupText className="min-w-0 flex-1 rounded-lg bg-background/50 px-3 py-2 text-xs font-normal shadow-none dark:border-input dark:bg-input/30">
            {none ? (
              <TriangleAlert className="size-3.5 shrink-0 text-warn" />
            ) : (
              <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span
              className={cn(
                "flex-1 truncate leading-8",
                none ? "text-foreground" : "font-mono text-muted-foreground"
              )}
            >
              {none ? "No cloud folder chosen yet" : cloudDir}
            </span>
          </ButtonGroupText>
          <Button
            variant="outline"
            size="row"
            onClick={pickFolder}
            className={cn("h-auto rounded-lg", cloudDir === undefined && "invisible")}
          >
            {none ? "Choose" : "Change"}
          </Button>
        </ButtonGroup>

        <div className="flex flex-col gap-2">
          {SHARE_OPTIONS.map((o) => (
            <ShareOption
              key={o.id}
              icon={ICONS[o.id]}
              title={o.label}
              hint={o.hint}
              done={there[o.id]}
              busy={busy === o.id}
              disabled={!cloudDir || busy !== null}
              onClick={() => void share(o.id)}
            />
          ))}
        </div>

        {/* The options act at once, so there is nothing to cancel: the one
            button is the way out. */}
        <DialogButtons
          cancel="Close"
          cancelDisabled={busy !== null}
          aside={
            isShared && (
              <Button
                variant="ghost"
                size="row"
                disabled={busy !== null}
                onClick={() => void remove()}
                className="text-muted-foreground hover:text-destructive"
              >
                {/* Its icon turns into the spinner after the second (B5), in
                    the icon's room: the button and its words never move. */}
                {removing ? <Spinner after={0} /> : <CloudOff />}
                Remove from the cloud
              </Button>
            )
          }
        />
      </DialogContent>
    </Dialog>
  )
}
