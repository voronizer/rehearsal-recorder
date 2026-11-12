import { useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useSidebar } from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { Size } from "./size"

/*
  Folding the column of sections by hand, all of it here: the fold the
  browser keeps, how it joins the fold the frame makes by itself, and the
  round handle on the column's edge (Alex, 2026-11-12, 10:22:43). The fold
  is the browser's, not the member's, as Master's level is
  (takes/player/master.ts; Alex, 10:23:55). A browser that keeps nothing
  opens the menu each time, and the handle still folds it for the visit.
*/

const KEY = "reha.menu"

/** Whether this browser keeps the menu folded; open when it keeps nothing. */
export function keptFold(): boolean {
  try {
    return localStorage.getItem(KEY) === "folded"
  } catch {
    return false
  }
}

/** Keeps the fold for the next visit in this browser. */
export function keepFold(folded: boolean): void {
  try {
    if (folded) localStorage.setItem(KEY, "folded")
    else localStorage.removeItem(KEY)
  } catch {
    // A browser that keeps nothing opens the menu next time.
  }
}

/**
 * The column's `open` for its SidebarProvider, by the band member's fold
 * and the frame's own: below 1100 px, while the panel stands beside the
 * page, the column folds by itself so the page keeps its room (Alex,
 * 2026-11-11, 22:23:17). Then the handle goes, since the column could not
 * open, and the fold the frame made is not kept: once the panel closes,
 * the column is as the band member left it.
 */
export function useMenuFold(size: Size, panel: boolean, pushes: boolean) {
  const [folded, setFolded] = useState(keptFold)
  const auto = size !== "wide" && panel && pushes
  const onOpenChange = (open: boolean) => {
    if (auto) return
    setFolded(!open)
    keepFold(!open)
  }
  return { open: !folded && !auto, onOpenChange, handle: !auto }
}

/**
 * The round handle on the column's right edge, level with the band's name:
 * ‹ folds the column to its icons, › opens it. The page's colour in both
 * themes; under the pointer only its chevron darkens. Its tip only repeats
 * its name, so it is for the eyes. It moves with the column's edge and
 * keeps the focus.
 */
export function MenuHandle() {
  const { open, toggleSidebar } = useSidebar()
  const name = open ? "Fold the menu" : "Open the menu"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon-tiny"
          aria-label={name}
          onClick={toggleSidebar}
          className="absolute top-[22px] -right-3 z-20 rounded-full text-muted-foreground hover:bg-background hover:text-foreground dark:bg-background dark:hover:bg-background"
        >
          {open ? <ChevronLeft className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">
        <span aria-hidden>{name}</span>
      </TooltipContent>
    </Tooltip>
  )
}
