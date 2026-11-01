import { useEffect, useState } from "react"
import { Outlet, useRouterState } from "@tanstack/react-router"
import { Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useFrame, useMe } from "../api"
import { LabelsPanel } from "../marks/LabelsPanel"
import { NewSongPanel } from "../songs/NewSongPanel"
import { SongPanel } from "../songs/parts"
import { StatusesPanel } from "../songs/StatusesPanel"
import { PlayerProvider } from "../takes/player/one"
import { TakePanel } from "../takes/TakePanel"
import { PanelProvider, usePanel } from "./panel"
import { InPanel } from "./parts"
import { PhoneBar, PlayerBar } from "./PlayerBar"
import { BandName, Side } from "./Side"
import { useSize } from "./size"

/** The panel from the right, as the app's Sheet: 28 rem, over the page, no veil, so the page stays live. */
function PanelView() {
  const { panel } = usePanel()
  const size = useSize()
  if (!panel) return null
  return (
    <aside
      key={JSON.stringify(panel)}
      aria-label="Panel"
      className={cn(
        "absolute inset-y-0 right-0 z-20 flex flex-col overflow-y-auto border-l bg-panel p-5 text-sm shadow-lg animate-in slide-in-from-right duration-200",
        size === "phone" ? "w-full border-l-0" : "w-[28rem] max-w-[calc(100%-3rem)]"
      )}
    >
      <InPanel>
        {panel.kind === "take" && <TakePanel uid={panel.uid} markAt={panel.markAt} />}
        {panel.kind === "song" && <SongPanel id={panel.id} />}
        {panel.kind === "labels" && <LabelsPanel />}
        {panel.kind === "statuses" && <StatusesPanel />}
        {panel.kind === "new-song" && <NewSongPanel />}
      </InPanel>
    </aside>
  )
}

/**
 * The band's pages in their frame: the column of sections down the left,
 * the page, the panel over it from the right, the player along the bottom
 * once the band has a take. On a phone the column hides behind ☰.
 */
function Frame() {
  const size = useSize()
  const bar = !!useFrame().data?.has_takes
  const { close } = usePanel()
  const [menu, setMenu] = useState(false)
  // A panel belongs to the page it was opened on.
  const path = useRouterState({ select: (s) => s.location.pathname })
  useEffect(() => {
    close()
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
        <div className="relative min-h-0 flex-1">
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
      <div className="relative flex min-h-0 flex-1">
        <Side />
        <main className={cn("min-w-0 flex-1 overflow-y-auto bg-background text-sm", size === "wide" ? "p-8" : "px-6 py-6")}>
          <Outlet />
        </main>
        <PanelView />
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
