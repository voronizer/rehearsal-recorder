import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { Outlet, useRouterState } from "@tanstack/react-router"
import { ChevronLeft, Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sidebar, SidebarProvider, useSidebar } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import { useFrame, useMe } from "../api"
import { LabelsEditor } from "../marks/Labels"
import { MarkPanel, TakeMarksPanel } from "../marks/MarkPanel"
import { StatusesEditor } from "../songs/Statuses"
import { PlayerProvider } from "../takes/player/one"
import { Strip } from "./drawer"
import { PanelProvider, usePanel } from "./panel"
import { InDrawer, InPanel } from "./parts"
import { PhoneBar, PlayerBar } from "./PlayerBar"
import { BandName, Side } from "./Side"
import { PageRoom, PHONE_BELOW, useSize } from "./size"

/** The column of sections: 224 px, 48 px folded to its icons. */
const LEFT = { "--sidebar-width": "14rem", "--sidebar-width-icon": "3rem" } as CSSProperties

/** The panel: 448 px, folded on a take's page to the strip's 48; in the service's panel colour, white in light. */
const RIGHT = { "--sidebar-width": "28rem", "--sidebar-width-icon": "3rem", "--sidebar": "var(--side)" } as CSSProperties

/**
 * What the panel holds, with **Back** when it was opened from another
 * panel. On a take's page (`page`, its uid) it folds into the strip rather
 * than closing.
 */
function PanelBody({ page }: { page?: string }) {
  const { panel, back, close } = usePanel()
  if (!panel) return null
  const body = (
    <InPanel>
      {panel.kind === "mark" && <MarkPanel uid={panel.uid} id={panel.id} at={panel.at} />}
      {panel.kind === "marks" && <TakeMarksPanel uid={panel.uid} />}
      {panel.kind === "statuses" && <StatusesEditor onClose={close} />}
      {panel.kind === "labels" && <LabelsEditor onClose={close} />}
    </InPanel>
  )
  return (
    <>
      {back && (
        // Opened from another panel: one step back to it, as Back does. The
        // margins keep it in the 32 px the bare words took, so nothing under it moves.
        <Button variant="ghost" size="row" onClick={back} className="-mt-1.5 mb-1.5 -ml-[11px] gap-1 self-start text-muted-foreground hover:text-foreground">
          <ChevronLeft />
          Back
        </Button>
      )}
      {page ? <InDrawer>{body}</InDrawer> : body}
    </>
  )
}

/**
 * The panel on a phone: over the page between the header and the player's
 * bar, the full width, with no veil, so the bar can still be used.
 */
function PhonePanel() {
  const { panel } = usePanel()
  if (!panel) return null
  return (
    <aside
      key={JSON.stringify(panel)}
      aria-label="Panel"
      className="absolute inset-y-0 right-0 z-20 flex w-full flex-col overflow-y-auto bg-side p-5 text-sm shadow-lg animate-in slide-in-from-right duration-200"
    >
      <PanelBody />
    </aside>
  )
}

/**
 * The column on the right, shadcn's Sidebar, open while the address names a
 * panel: beside the page, which narrows by its width (Alex, 2026-11-11,
 * 21:52:04). On a take's page (`take`, its uid) it folds into the strip;
 * elsewhere it is gone when closed. Its top and bottom are the page's, above
 * the player's bar.
 */
function RightColumn({ take, children }: { take?: string; children: ReactNode }) {
  const { panel, open, close } = usePanel()
  // A new panel in a column already open slides in, as one over the page
  // did; the first one comes with the column itself.
  const [was, setWas] = useState(panel)
  const [slide, setSlide] = useState(false)
  if (was !== panel) {
    setWas(panel)
    setSlide(!!was && !!panel)
  }
  return (
    <SidebarProvider
      mobileBelow={PHONE_BELOW}
      open={!!panel}
      onOpenChange={(opened) => {
        if (!opened) close()
        else if (take) open({ kind: "marks", uid: take })
      }}
      className="relative min-h-0 min-w-0 flex-1"
      style={RIGHT}
    >
      {children}
      {/* Anew between a take's page and another, so the strip comes and goes with its page instead of sliding. */}
      <Sidebar key={take ? "strip" : "page"} side="right" collapsible={take ? "icon" : "offcanvas"} className="absolute h-full">
        {panel ? (
          // The column's width less its line from the start: as the column
          // opens, the panel comes in from the edge with its lines unbroken.
          <aside
            key={JSON.stringify(panel)}
            aria-label="Panel"
            className={cn("flex h-full w-[calc(var(--sidebar-width)-1px)] flex-col overflow-y-auto p-5 text-sm", slide && "animate-in slide-in-from-right duration-200")}
          >
            <PanelBody page={take} />
          </aside>
        ) : (
          take && <Strip uid={take} />
        )}
      </Sidebar>
    </SidebarProvider>
  )
}

/**
 * ☰ on a phone: the column of sections, as the Sidebar's sheet from the
 * left. Closed, the focus comes back here, as to a sheet's own trigger.
 */
function MenuButton() {
  const { openMobile, setOpenMobile } = useSidebar()
  const button = useRef<HTMLButtonElement>(null)
  const was = useRef(openMobile)
  useEffect(() => {
    if (was.current && !openMobile) button.current?.focus()
    was.current = openMobile
  }, [openMobile])
  return (
    <Button ref={button} variant="ghost" size="icon" aria-label="Menu" aria-expanded={openMobile} onClick={() => setOpenMobile(true)}>
      <Menu className="size-5" />
    </Button>
  )
}

/** The take whose page this is, by its address. */
const takeOf = (path: string) => /^\/takes\/([^/]+)$/.exec(path)?.[1]

/**
 * The band's pages in their frame: the column of sections down the left,
 * the page, the panel beside it on the right (on a take's page folded into
 * its strip), the player along the bottom once the band has a take. Below
 * 1100 px the column of sections folds to its icons while the panel is open
 * (Alex, 2026-11-11, 22:23:17), so the page keeps its room. On a phone the
 * column hides behind ☰, the panel lies over the page, and a take's page has
 * no strip.
 */
function Frame() {
  const size = useSize()
  const bar = !!useFrame().data?.has_takes
  const { panel } = usePanel()
  // A panel belongs to the page it was opened on: it is in that page's
  // address, so going to another page leaves it behind by itself.
  const path = useRouterState({ select: (s) => s.location.pathname })
  const take = takeOf(path)
  if (size === "phone")
    return (
      <SidebarProvider mobileBelow={PHONE_BELOW} className="h-full min-h-0 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-panel px-2">
          <MenuButton />
          <BandName small />
        </header>
        {/* Clipped, not scrolled: a panel sliding in from beyond the edge, or a box
            in it taking the focus, must not make the page wider than the phone. */}
        <div className="relative min-h-0 flex-1 overflow-clip">
          <main className="h-full overflow-y-auto bg-background px-4 py-5 text-sm">
            <Outlet />
          </main>
          <PhonePanel />
        </div>
        {bar && <PhoneBar />}
        <Side />
      </SidebarProvider>
    )
  return (
    <div className="flex h-full flex-col">
      <SidebarProvider mobileBelow={PHONE_BELOW} open={size === "wide" || !panel} className="relative min-h-0 flex-1 overflow-clip" style={LEFT}>
        <Side />
        <RightColumn take={take}>
          {/* --screen-pad-y is the padding above and below, as in РЭХА's Shell: Master's row, stuck at the
              window's foot, reaches down past it so no lane shows under it (Timeline). */}
          <main
            className={cn(
              "min-w-0 flex-1 overflow-y-auto bg-background py-(--screen-pad-y) text-sm",
              size === "wide" ? "px-8 [--screen-pad-y:2rem]" : "px-6 [--screen-pad-y:1.5rem]"
            )}
          >
            {/* The page lays out by the room it has: beside an open panel on a wide window, as in a narrow one. */}
            <PageRoom.Provider value={size === "wide" && panel ? "narrow" : null}>
              <Outlet />
            </PageRoom.Provider>
          </main>
        </RightColumn>
      </SidebarProvider>
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
