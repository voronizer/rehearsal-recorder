import { FolderOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { api, type Take } from "@/lib/api"
import { eveningOf, lengthLabel, takesLine } from "@/lib/evening"
import { formatBytes } from "@/lib/format"
import { notify } from "@/lib/notices"
import { useSystem, words } from "@/lib/platform"
import { cn } from "@/lib/utils"

function Fact({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    // In a narrow window only the length and the takes are said: the app
    // opens down to 960 px, and the title needs the room.
    <div className={cn("flex-col gap-0.5 whitespace-nowrap", wide ? "hidden xl:flex" : "flex")}>
      <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="text-sm font-semibold">{value}</dd>
    </div>
  )
}

/**
 * What there is to know about a rehearsal, in the window's header beside
 * its name: how long its takes run, how many and of how many songs, how
 * many are in the cloud, how much of the disk it uses, and a button to its
 * folder. Counted from the takes on screen, so it follows a take kept,
 * deleted or copied at once; only the size on disk comes from Python.
 */
export function EveningFacts({
  takes,
  bytes,
  folder,
}: {
  takes: Take[]
  bytes: number | null
  folder: string
}) {
  const f = eveningOf(takes)
  const { folderButton } = words(useSystem())
  const show = async () => {
    const res = await api().show_rehearsal_folder(folder)
    if (!res.ok) notify({ key: "folder", kind: "error", text: res.error ?? "Could not open the folder" })
  }
  return (
    <div role="group" aria-label="About this rehearsal" className="flex shrink-0 items-center gap-7">
      <dl className="flex items-center gap-7">
        <Fact label="Length" value={lengthLabel(f.seconds)} />
        <Fact label="Takes" value={takesLine(f)} />
        <Fact label="In the cloud" value={`${f.inCloud} of ${f.takes}`} wide />
        {bytes !== null && <Fact label="On disk" value={formatBytes(bytes)} wide />}
      </dl>
      {/* The path is not shown (Alex, 2026-10-06): the button is enough, and
          it is there under the mouse for whoever wants it. */}
      <Button variant="outline" size="sm" title={folder} onClick={() => void show()}>
        <FolderOpen className="text-muted-foreground" />
        {folderButton}
      </Button>
    </div>
  )
}
