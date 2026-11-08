import type { ReactNode } from "react"
import { Diamond, PanelRightOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useTake } from "../api"
import { usePanel } from "./panel"

/** A sign in the strip, with its tip. */
function Sign({ name, tip, onClick, children }: { name: string; tip: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" aria-label={name} onClick={onClick} className="h-auto w-9 flex-col gap-0.5 px-0 py-1.5 text-xs text-muted-foreground hover:text-foreground">
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">{tip}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The panel on a take's page, on a computer (Alex, 2026-11-08: «шторка»,
 * a strip with icons): folded, a strip down the right edge, in the grey of
 * the column of sections on the left, with the sign that opens it and a
 * sign for each of its sections, now the take's marks with how many it
 * has. Open, `children`, the panel, lies over the lanes as anywhere else;
 * it folds back into the strip instead of going away.
 */
export function Drawer({ uid, children }: { uid: string; children: ReactNode }) {
  const { open } = usePanel()
  const take = useTake(uid).data
  const list = () => open({ kind: "marks", uid })
  return (
    <>
      {/* There from the start, so the page does not move; its signs once the take has come. */}
      <aside aria-label="Strip" className="flex w-12 shrink-0 flex-col items-center gap-1 border-l bg-panel pt-3">
        {take && (
          <>
            <Sign name="Open the panel" tip="Open the panel" onClick={list}>
              <PanelRightOpen className="size-4" />
            </Sign>
            <Sign name={`Marks: ${take.marks.length}`} tip="Marks" onClick={list}>
              <Diamond className="size-4" />
              <span className="tnum">{take.marks.length}</span>
            </Sign>
          </>
        )}
      </aside>
      {children}
    </>
  )
}
