import { CheckCircle2, History, Radio } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Shell, SpaceHint } from "@/components/Shell"
import { useSpacebar } from "@/hooks/useSpacebar"
import { takesLabel } from "@/lib/format"

export function Finished({
  folder,
  takeCount,
  onNewRehearsal,
  onOpenHistory,
}: {
  folder: string
  takeCount: number
  onNewRehearsal: () => void
  onOpenHistory: () => void
}) {
  useSpacebar(onNewRehearsal)

  return (
    <Shell
      footer={
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="lg" onClick={onOpenHistory}>
              <History />
              History
            </Button>
            <Button size="lg" onClick={onNewRehearsal}>
              <Radio />
              New rehearsal
            </Button>
          </div>
          <SpaceHint>starts a new rehearsal</SpaceHint>
        </div>
      }
    >
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <CheckCircle2 className="size-12 text-signal" />
        <div>
          <h2 className="text-xl font-semibold">Rehearsal finished</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Saved: {takesLabel(takeCount)}
          </p>
        </div>
        {takeCount > 0 && (
          <div className="max-w-xl rounded-lg border bg-card px-4 py-3 font-mono text-xs break-all text-muted-foreground">
            {folder}
          </div>
        )}
      </div>
    </Shell>
  )
}
