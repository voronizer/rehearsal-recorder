import { useEffect, type CSSProperties } from "react"
import { Link, useLocation, useNavigate } from "@tanstack/react-router"
import { Ellipsis } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Sidebar, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import { queryClient, useFrame, useMe } from "../api"
import { authClient } from "../auth"
import { MenuHandle } from "./menu"
import { Avatar, Logo } from "./parts"
import { SECTION, SECTIONS } from "./sections"
import { count } from "./words"

/** The band's logo and name, grey “Band name” until the owner gives one. */
export function BandName({ small }: { small?: boolean }) {
  const frame = useFrame().data
  const name = frame?.name ?? ""
  return (
    <>
      <Logo name={name} picture={frame?.picture ?? null} className={small ? "size-7 rounded-md text-sm" : undefined} />
      <span className={cn("min-w-0 truncate font-semibold", !name && "text-muted-foreground")}>{name || "Band name"}</span>
    </>
  )
}

/** Your name at the bottom: **Change your name** and **Sign out** (this sign-in only). Folded, your letter alone. */
function You() {
  const me = useMe().data
  const navigate = useNavigate()
  const { href } = useLocation()
  if (!me) return null
  const signOut = async () => {
    await authClient.signOut()
    queryClient.clear()
    await navigate({ to: "/signin", search: { redirect: undefined }, replace: true })
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-10 justify-start gap-2 px-2 group-data-[collapsible=icon]:w-9 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <Avatar letter={(Array.from(me.name.trim())[0] ?? "?").toUpperCase()} />
          {/* Folded, the name is still the button's for a screen reader. */}
          <span className="min-w-0 flex-1 truncate text-left group-data-[collapsible=icon]:sr-only">{me.name}</span>
          {/* Your name, Change your name and Sign out are behind it: ⋯ says there is more. */}
          <Ellipsis className="text-muted-foreground group-data-[collapsible=icon]:hidden" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-52">
        <DropdownMenuItem onSelect={() => void navigate({ to: "/name", search: { redirect: href } })}>Change your name</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void signOut()}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The phone's menu, as wide as it was. On the Sidebar itself: the sheet it opens in hangs from the page's body. */
const PHONE_WIDTH = { "--sidebar-width-mobile": "16rem" } as CSSProperties

/**
 * The column down the left, shadcn's Sidebar: the band, how many members,
 * the sections (Marks with how many are open), your name. With `handle`,
 * the round handle on its edge folds it and opens it (shell/menu.tsx).
 * Folded, the logo, the sections' icons, each section's name in its tip,
 * and your letter; Marks has no count (Alex, 2026-11-12, 10:26:28). On a
 * phone it is the sheet behind ☰, with no handle, and a section pressed,
 * or any move to another page, closes it. A take's page lights **Songs**,
 * where the band finds its takes, also those with no song (under
 * **Not named**).
 */
export function Side({ handle }: { handle?: boolean }) {
  const frame = useFrame().data
  const path = useLocation({ select: (l) => l.pathname })
  const { isMobile, setOpenMobile } = useSidebar()
  useEffect(() => setOpenMobile(false), [path, setOpenMobile])
  const onTake = path.startsWith("/takes/")
  const lit = (to: string) => (to === "/" ? path === "/" : path === to || path.startsWith(`${to}/`) || (onTake && to === "/songs"))
  return (
    // Inside the frame's row, above the player's bar, not the window's height.
    <Sidebar side="left" collapsible="icon" className="absolute h-full group-data-[side=left]:border-r-0" style={PHONE_WIDTH}>
      {/* First for Tab; outside the aside, whose scrolling would cut it at the edge. */}
      {handle && !isMobile && <MenuHandle />}
      {/* A landmark of its own, as the column was before the Sidebar, whose parts are bare boxes. */}
      <aside className="flex h-full flex-col gap-5 overflow-y-auto p-3 group-data-[collapsible=icon]:overflow-hidden group-data-[collapsible=icon]:px-1.5">
        <div className="flex items-center gap-3 px-2 pt-1 group-data-[collapsible=icon]:px-0">
          <Logo name={frame?.name ?? ""} picture={frame?.picture ?? null} />
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <div className={cn("truncate font-semibold", !frame?.name && "text-muted-foreground")}>{frame?.name || "Band name"}</div>
            <div className="truncate text-xs text-muted-foreground">{frame ? count(frame.members, "member") : ""}</div>
          </div>
        </div>
        <nav aria-label="Sections">
          <SidebarMenu className="gap-0.5">
            {SECTIONS.map(([to, label, Icon]) => (
              <SidebarMenuItem key={to}>
                <SidebarMenuButton asChild isActive={lit(to)} tooltip={label} className={SECTION}>
                  {/* Lit, and the page for a screen reader, by lit(). The link marks its own page too (Home's only when exact), which lit() always counts. */}
                  <Link to={to} onClick={() => setOpenMobile(false)} activeOptions={{ exact: to === "/" }} aria-current={lit(to) ? "page" : undefined}>
                    <Icon className="text-muted-foreground" />
                    <span>{label}</span>
                    {to === "/marks" && !!frame?.open_marks && <span className="tnum ml-auto text-xs text-muted-foreground">{frame.open_marks}</span>}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </nav>
        <span className="flex-1" />
        <You />
      </aside>
    </Sidebar>
  )
}
