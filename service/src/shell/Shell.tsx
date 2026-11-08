import { useEffect, useState } from "react"
import { Outlet, useRouterState } from "@tanstack/react-router"
import { ChevronLeft, Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useFrame, useMe } from "../api"
import { MarkPanel, TakeMarksPanel } from "../marks/MarkPanel"
import { PlayerProvider } from "../takes/player/one"
import { TakePanel } from "../takes/TakePanel"
import { Drawer } from "./drawer"
import { PanelProvider, usePanel } from "./panel"
import { InDrawer, InPanel } from "./parts"
import { PhoneBar, PlayerBar } from "./PlayerBar"
import { BandName, Side } from "./Side"
import { useSize } from "./size"

/**
 * The panel from the right, as the app's Sheet: 28 rem, over the page, no
 * veil, so the page stays live. On a take's page (`page`, its uid) it is
 * the drawer that folds into its strip, and the take's own panel there is
 * its marks alone, so the page is not drawn twice.
 */
function PanelView({ page }: { page?: string }) {
  const { panel, back } = usePanel()
  const size = useSize()
  if (!panel) return null
  const marks = panel.kind === "marks" || (panel.kind === "take" && panel.uid === page)
  const body = (
    <InPanel>
      {panel.kind === "mark" && <MarkPanel uid={panel.uid} id={panel.id} at={panel.at} />}
      {panel.kind === "take" && !marks && <TakePanel uid={panel.uid} markAt={panel.markAt} />}
      {marks && <TakeMarksPanel uid={panel.uid} markAt={panel.kind === "take" ? panel.markAt : undefined} />}
    </InPanel>
  )
  return (
    <aside
      key={JSON.stringify(panel)}
      aria-label="Panel"
      className={cn(
        "absolute inset-y-0 right-0 z-20 flex flex-col overflow-y-auto border-l bg-side p-5 text-sm shadow-lg animate-in slide-in-from-right duration-200",
        size === "phone" ? "w-full border-l-0" : "w-[28rem] max-w-[calc(100%-3rem)]"
      )}
    >
      {back && (
        // Opened from another panel: one step back to it, as Back does.
        <button type="button" onClick={back} className="mb-3 flex items-center gap-1 self-start text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" />
          Back
        </button>
      )}
      {page ? <InDrawer>{body}</InDrawer> : body}
    </aside>
  )
}

/** The take whose page this is, by its address. */
const takeOf = (path: string) => /^\/takes\/([^/]+)$/.exec(path)?.[1]

/**
 * The band's pages in their frame: the column of sections down the left,
 * the page, the panel over it from the right (on a take's page the drawer
 * with its strip), the player along the bottom once the band has a take.
 * On a phone the column hides behind ☰, and a take's page has no strip.
 */
function Frame() {
  const size = useSize()
  const bar = !!useFrame().data?.has_takes
  const [menu, setMenu] = useState(false)
  // A panel belongs to the page it was opened on: it is in that page's
  // address, so going to another page leaves it behind by itself.
  const path = useRouterState({ select: (s) => s.location.pathname })
  const take = takeOf(path)
  useEffect(() => {
    setMenu(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])
  if (size === "phone")
    return (
      <div className="flex h-full flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-panel px-2">
          <Button variant="ghost" size="icon" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(true)}>
            <Menu className="size-5" />
          </Button>
          <BandName small />
        </header>
        {/* Clipped, not scrolled: a panel sliding in from beyond the edge, or a box
            in it taking the focus, must not make the page wider than the phone. */}
        <div className="relative min-h-0 flex-1 overflow-clip">
          <main className="h-full overflow-y-auto bg-background px-4 py-5 text-sm">
            <Outlet />
          </main>
          <PanelView />
          {menu && (
            <div className="absolute inset-0 z-30 flex">
              <div className="animate-in slide-in-from-left duration-200">
                <Side onGo={() => setMenu(false)} />
              </div>
              <button type="button" aria-label="Close the menu" className="flex-1 bg-black/30" onClick={() => setMenu(false)} />
            </div>
          )}
        </div>
        {bar && <PhoneBar />}
      </div>
    )
  return (
    <div className="flex h-full flex-col">
      <div className="relative flex min-h-0 flex-1 overflow-clip">
        <Side />
        {/* --screen-pad-y is the padding above and below, as in РЭХА's Shell: Master's row, stuck at the
            window's foot, reaches down past it so no lane shows under it (Timeline). */}
        <main
          className={cn(
            "min-w-0 flex-1 overflow-y-auto bg-background py-(--screen-pad-y) text-sm",
            size === "wide" ? "px-8 [--screen-pad-y:2rem]" : "px-6 [--screen-pad-y:1.5rem]"
          )}
        >
          <Outlet />
        </main>
        {take ? (
          <Drawer uid={take}>
            <PanelView page={take} />
          </Drawer>
        ) : (
          <PanelView />
        )}
      </div>
      {bar && <PlayerBar />}
    </div>
  )
}

/** The shell: one player and one panel for every page inside it. */
export function Shell() {
  const me = useMe()
  if (me.isPending) return null
  return (
    <PlayerProvider>
      <PanelProvider>
        <Frame />
      </PanelProvider>
    </PlayerProvider>
  )
}
