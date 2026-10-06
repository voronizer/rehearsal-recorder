import { Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/Shell"
import { RunningLine } from "@/components/RunningLine"
import type { ActivityEntry } from "@/lib/api"

/**
 * The recording screen's Stop, and the line under it: the take being saved
 * once it is pressed, and until then that nothing is lost if the power goes.
 * The website shows it too, in a tile.
 *
 * It binds no key: the screen's Space does that, as it does everywhere.
 */
export function StopTake({
  onStop,
  stopping,
  saving,
}: {
  onStop: () => void
  stopping: boolean
  saving: ActivityEntry | null
}) {
  return (
    <>
      <Button size="xl" onClick={onStop} disabled={stopping} aria-keyshortcuts="Space">
        <Square className="fill-current" />
        Stop
        <Kbd>Space</Kbd>
      </Button>
      {stopping ? (
        <RunningLine entry={saving} label="Saving the take" active />
      ) : (
        <p className="text-xs text-muted-foreground">autosaved every 30 s</p>
      )}
    </>
  )
}
