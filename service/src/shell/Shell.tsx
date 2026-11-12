import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react"
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
import { useMenuFold } from "./menu"
import { InDrawer, InPanel } from "./parts"
import { PhoneBar, PlayerBar } from "./PlayerBar"
import { BandName, Side } from "./Side"
import { PageRoom, PHONE_BELOW, usePushes, useSize } from "./size"

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
 * the player's bar. In a window too small to push the page (`over`, under
 * `PUSH_FROM`) it opens over the page, 448 px, with a shadow, and the page
 * keeps its room (Alex, 2026-11-11, 23:19:52). Only its classes change
 * between the two, so a comment being typed in the panel stays as the
 * window crosses the line.
 */
function RightColumn({ take, over, children }: { take?: string; over: boolean; children: ReactNode }) {
  const { panel, close } = usePanel()
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
      onOpenChange={(opened) => !opened && close()}
      // Over the page, the column's gap keeps its folded width, so the page does not narrow.
      className={cn("relative min-h-0 min-w-0 flex-1", over && (take ? "[&_[data-slot=sidebar-gap]]:w-(--sidebar-width-icon)!" : "[&_[data-slot=sidebar-gap]]:w-0!"))}
      style={RIGHT}
    >
      {children}
      {/* Anew between a take's page and another, so the strip comes and goes with its page instead of sliding. */}
      <Sidebar
        key={take ? "strip" : "page"}
        side="right"
        collapsible={take ? "icon" : "offcanvas"}
        // Over the page, as wide as the window less 48 px at most, as the panel was before the Sidebar.
        className={cn("absolute h-full", over && "z-20 max-w-[calc(100vw-3rem)]", over && panel && "shadow-lg")}
      >
        {panel ? (
          // The column's width less its line from the start: as the column
          // opens, the panel comes in from the edge with its lines unbroken.
          <aside
            key={JSON.stringify(panel)}
            aria-label="Panel"
            className={cn(
              "flex h-full w-[calc(var(--sidebar-width)-1px)] max-w-[calc(100vw-3rem-1px)] flex-col overflow-y-auto p-5 text-sm",
              slide && "animate-in slide-in-from-right duration-200"
            )}
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

/** How long after a press a panel that comes is taken as opened by it. */
const PRESS_MS = 1000

/** What counts as a press in the page, each heard before the page's own handlers. */
const PRESSES = ["pointerdown", "click", "keydown"] as const

/**
 * The row that opened the panel stays in view as the page takes its new room
 * beside the panel, opened or closed: on a wide window the page lays out
 * anew (PageRoom), and Home's Latest marks goes under its songs. The row is
 * what was pressed in the page, by pointer or key, in the second before the
 * panel came; one opened from elsewhere, such as the strip, another panel
 * or Back, keeps the row before. A panel closed after the band has scrolled
 * the row out of view leaves the page where it is. Kept at once, not
 * smoothly, so it is still under Reduce motion.
 */
function useOpenerInView(main: RefObject<HTMLElement | null>, panel: string | null) {
  const pressed = useRef<{ row: Element; at: number } | null>(null)
  const opener = useRef<Element | null>(null)
  // Whether the opener was in the page's view at the last press.
  const seen = useRef(true)
  const was = useRef(!!panel)
  useEffect(() => {
    const press = (e: Event) => {
      pressed.current = e.target instanceof Element ? { row: e.target, at: performance.now() } : null
      const page = main.current
      const row = opener.current
      if (!page || !row?.isConnected) return void (seen.current = false)
      const view = page.getBoundingClientRect()
      const box = row.getBoundingClientRect()
      seen.current = box.bottom > view.top && box.top < view.bottom
    }
    // The click too: a panel opens on it, and a press held past a second still opened this one.
    for (const kind of PRESSES) document.addEventListener(kind, press, true)
    return () => {
      for (const kind of PRESSES) document.removeEventListener(kind, press, true)
    }
  }, [main])
  useLayoutEffect(() => {
    const page = main.current
    const last = pressed.current
    pressed.current = null
    // Only a press of the last second can have opened this panel; an older one was for something else, and Back or an address came after it.
    const row = last && performance.now() - last.at < PRESS_MS ? last.row : null
    if (panel && page && row && row !== page && page.contains(row)) opener.current = row
    else if (panel && !was.current) opener.current = null
    else if (!panel && !seen.current) opener.current = null
    const moved = was.current !== !!panel
    was.current = !!panel
    if (!moved || !page) return
    const keep = () => {
      if (opener.current?.isConnected) opener.current.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" })
    }
    keep()
    // And while the column opens or folds over its 200 ms.
    const watch = new ResizeObserver(keep)
    watch.observe(page)
    const stop = window.setTimeout(() => watch.disconnect(), 300)
    return () => {
      window.clearTimeout(stop)
      watch.disconnect()
    }
  }, [main, panel])
}

/** The take whose page this is, by its address. */
const takeOf = (path: string) => /^\/takes\/([^/]+)$/.exec(path)?.[1]

/**
 * The band's pages in their frame: the column of sections down the left,
 * the page, the panel beside it on the right (on a take's page folded into
 * its strip), the player along the bottom once the band has a take. The
 * band member folds the column to its icons by its handle, and the browser
 * keeps the fold (Alex, 2026-11-12, 10:22:43; shell/menu.tsx). Below
 * 1100 px it also folds by itself while the panel is open (Alex,
 * 2026-11-11, 22:23:17), so the page keeps its room, and the handle goes
 * until the panel closes. Below `PUSH_FROM` the panel lies over the page
 * instead, and the column stays as the band member left it. On a phone the
 * column hides behind ☰, with no handle, the panel lies over the page, and
 * a take's page has no strip.
 */
function Frame() {
  const size = useSize()
  const pushes = usePushes()
  const bar = !!useFrame().data?.has_takes
  const { panel } = usePanel()
  const main = useRef<HTMLElement>(null)
  useOpenerInView(main, panel && JSON.stringify(panel))
  // A panel belongs to the page it was opened on: it is in that page's
  // address, so going to another page leaves it behind by itself.
  const path = useRouterState({ select: (s) => s.location.pathname })
  const take = takeOf(path)
  const menu = useMenuFold(size, !!panel, pushes)
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
      <SidebarProvider mobileBelow={PHONE_BELOW} open={menu.open} onOpenChange={menu.onOpenChange} className="relative min-h-0 flex-1 overflow-clip" style={LEFT}>
        <Side handle={menu.handle} />
        <RightColumn take={take} over={!pushes}>
          {/* --screen-pad-y is the padding above and below, as in РЭХА's Shell: Master's row, stuck at the
              window's foot, reaches down past it so no lane shows under it (Timeline). */}
          <main
            ref={main}
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
