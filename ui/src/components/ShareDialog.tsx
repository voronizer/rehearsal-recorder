import { useEffect, useState } from "react"
import { CloudUpload, FolderOpen, Loader2, Layers, Music4 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogButtons,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { api, type ShareWhat, type Take } from "@/lib/api"
import { pollSoon } from "@/lib/activity"
import { reloadEveningSettings } from "@/hooks/useEveningSettings"
import { useHeld } from "@/lib/held"

/**
 * Putting one take into the cloud folder.
 *
 * Copying everything would mean syncing every failed attempt, which is most of
 * a rehearsal. So it is done here, per take, after listening — and with a
 * choice: the mix is what gets sent to people, the original tracks are what
 * someone opens in a DAW later.
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
  const [cloudDir, setCloudDir] = useState<string | null>(null)
  const [busy, setBusy] = useState<ShareWhat | "remove" | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The take the dialog names, until it has faded out.
  const shown = useHeld<Take | null>(take, null)
  const shared = shown?.cloud ?? {}
  const isShared = Boolean(shared.mix || shared.tracks)

  useEffect(() => {
    if (!take) return
    setError(null)
    void api()
      .get_settings()
      .then((s) => setCloudDir(s.cloud_dir))
  }, [take])

  const pickFolder = async () => {
    setError(null)
    const res = await api().choose_cloud_dir()
    if (res.cancelled) return
    if (!res.ok) {
      setError(res.error ?? "Could not open the folder picker")
      return
    }
    setCloudDir(res.cloud_dir ?? null)
    // Send starred, over the takes, goes by it too.
    void reloadEveningSettings()
  }

  const share = async (what: ShareWhat) => {
    if (!take) return
    setError(null)
    setBusy(what)
    const res = await api().share_take(folder, take.take_number, what)
    setBusy(null)
    if (!res.ok) {
      setError(res.error ?? "Could not copy the take")
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
    setError(null)
    setBusy("remove")
    const res = await api().unshare_take(folder, take.take_number)
    setBusy(null)
    if (!res.ok) {
      setError(res.error ?? "Could not remove the copies")
      return
    }
    onDone()
    onOpenChange(false)
  }

  return (
    <Dialog open={take !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy “{shown?.name ?? ""}” to the cloud</DialogTitle>
          <DialogDescription>
            The files are copied into your cloud folder — whatever client
            watches it does the uploading.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 rounded-lg border bg-background/50 px-3 py-2">
          <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
          <span
            className={cn(
              "flex-1 truncate font-mono text-xs",
              cloudDir ? "text-muted-foreground" : "text-warn"
            )}
          >
            {cloudDir ?? "No cloud folder chosen yet"}
          </span>
          <Button variant="ghost" size="row" onClick={pickFolder}>
            {cloudDir ? "Change" : "Choose"}
          </Button>
        </div>

        <div className="flex flex-col gap-2">
          <ShareOption
            icon={<Music4 />}
            title="The mix"
            hint="One stereo file with the balance you set here. This is what you send people."
            done={Boolean(shared.mix)}
            busy={busy === "mix"}
            disabled={!cloudDir || busy !== null}
            onClick={() => void share("mix")}
          />
          <ShareOption
            icon={<Layers />}
            title="The original tracks"
            hint="Every track as recorded, untouched, and the notes as .mid — for opening in a DAW later."
            done={Boolean(shared.tracks)}
            busy={busy === "tracks"}
            disabled={!cloudDir || busy !== null}
            onClick={() => void share("tracks")}
          />
          <ShareOption
            icon={<CloudUpload />}
            title="Both"
            hint="The mix to listen to, the tracks to work from."
            done={Boolean(shared.mix && shared.tracks)}
            busy={busy === "both"}
            disabled={!cloudDir || busy !== null}
            onClick={() => void share("both")}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

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
                {busy === "remove" && <Loader2 className="animate-spin" />}
                Remove from the cloud
              </Button>
            )
          }
        />
      </DialogContent>
    </Dialog>
  )
}

function ShareOption({
  icon,
  title,
  hint,
  done,
  busy,
  disabled,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  hint: string
  done: boolean
  busy: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={title}
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors",
        "hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-50",
        done && "border-signal/40 bg-signal/5"
      )}
    >
      <span className="mt-0.5 shrink-0 text-muted-foreground [&>svg]:size-4">
        {busy ? <Loader2 className="size-4 animate-spin" /> : icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-medium">
          {title}
          {done && <span className="text-xs text-signal">already there</span>}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {hint}
        </span>
      </span>
    </button>
  )
}
