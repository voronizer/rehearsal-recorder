import type { ReactNode } from "react"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { useBand } from "../api"
import { Logo } from "../shell/parts"

/** A page of its own, before the band's pages: a card in the middle with the band's picture and name. */
export function Frame({ children }: { children: ReactNode }) {
  const band = useBand().data
  return (
    <main className="flex min-h-full items-center justify-center p-4">
      {/* The shared Card, on the page's own white and with its shadow, as a page of its own before the band's. */}
      <Card className="w-full max-w-sm gap-6 bg-background p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <Logo name={band?.name ?? ""} picture={band?.picture ?? null} />
          <span className={cn("font-semibold", !band?.name && "text-muted-foreground")}>{band?.name || "Band name"}</span>
        </div>
        {children}
      </Card>
    </main>
  )
}
