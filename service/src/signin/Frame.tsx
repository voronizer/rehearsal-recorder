import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { useBand } from "../api"
import { Logo } from "../shell/parts"

/** A page of its own, before the band's pages: a card in the middle with the band's picture and name. */
export function Frame({ children }: { children: ReactNode }) {
  const band = useBand().data
  return (
    <main className="flex min-h-full items-center justify-center p-4">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-xl bg-background p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <Logo name={band?.name ?? ""} picture={band?.picture ?? null} />
          <span className={cn("font-semibold", !band?.name && "text-muted-foreground")}>{band?.name || "Band name"}</span>
        </div>
        {children}
      </div>
    </main>
  )
}
