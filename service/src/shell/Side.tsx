import { Link, useLocation, useNavigate } from "@tanstack/react-router"
import { CalendarDays, Diamond, House, Music, Trash2, Users, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { queryClient, useFrame, useMe } from "../api"
import { authClient } from "../auth"
import { Avatar, Logo } from "./parts"
import { count } from "./words"

type To = "/" | "/rehearsals" | "/songs" | "/marks" | "/members" | "/trash"

const SECTIONS: [To, string, LucideIcon][] = [
  ["/", "Home", House],
  ["/rehearsals", "Rehearsals", CalendarDays],
  ["/songs", "Songs", Music],
  ["/marks", "Marks", Diamond],
  ["/members", "Members", Users],
  ["/trash", "Trash", Trash2],
]

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

/** Your name at the bottom: **Change your name** and **Sign out** (this sign-in only). */
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
        <Button variant="ghost" className="h-10 justify-start gap-2 px-2">
          <Avatar letter={(Array.from(me.name.trim())[0] ?? "?").toUpperCase()} />
          <span className="min-w-0 truncate">{me.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-52">
        <DropdownMenuItem onSelect={() => void navigate({ to: "/name", search: { redirect: href } })}>Change your name</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void signOut()}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The column down the left: the band, how many members, the sections
 * (Marks with how many are open), your name. `onGo`: on a phone, where the
 * column comes over the page, a section pressed closes it.
 */
export function Side({ onGo }: { onGo?: () => void }) {
  const frame = useFrame().data
  return (
    <aside className={cn("flex shrink-0 flex-col gap-5 overflow-y-auto bg-panel p-3", onGo ? "h-full w-64" : "w-56")}>
      <div className="flex items-center gap-3 px-2 pt-1">
        <Logo name={frame?.name ?? ""} picture={frame?.picture ?? null} />
        <div className="min-w-0">
          <div className={cn("truncate font-semibold", !frame?.name && "text-muted-foreground")}>{frame?.name || "Band name"}</div>
          <div className="text-xs text-muted-foreground">{frame ? count(frame.members, "member") : ""}</div>
        </div>
      </div>
      <nav aria-label="Sections" className="flex flex-col gap-0.5">
        {SECTIONS.map(([to, label, Icon]) => (
          <Button key={to} asChild variant="ghost" className="h-9 justify-start gap-3 px-3">
            <Link
              to={to}
              onClick={onGo}
              activeOptions={{ exact: to === "/" }}
              activeProps={{ className: "bg-selected hover:bg-selected dark:hover:bg-selected" }}
            >
              <Icon className="text-muted-foreground" />
              {label}
              {to === "/marks" && !!frame?.open_marks && <span className="tnum ml-auto text-xs text-muted-foreground">{frame.open_marks}</span>}
            </Link>
          </Button>
        ))}
      </nav>
      <span className="flex-1" />
      <You />
    </aside>
  )
}
