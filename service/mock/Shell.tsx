import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { CalendarDays, Diamond as DiamondIcon, House, Menu, Music, Trash2, Users, type LucideIcon } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { PlayButton } from "@/components/ui/play-button"
import { cn } from "@/lib/utils"
import { useAccount, useAt, usePanel, usePlayer, useWide } from "./context"
import { dayOf, fmt, memberOf, takeOf, useData } from "./data"
import { SongPanel, TakePanel } from "./panels"
import { LabelsPanel, NewSongPanel, StatusesPanel } from "./more"
import { InPanel, StarButton, TakeLink } from "./parts"

const NAV: [string, string, LucideIcon][] = [
  ["/", "Home", House],
  ["/rehearsals", "Rehearsals", CalendarDays],
  ["/songs", "Songs", Music],
  ["/marks", "Marks", DiamondIcon],
  ["/members", "Members", Users],
  ["/trash", "Trash", Trash2],
]

export function Avatar({ letter, className }: { letter: string; className?: string }) {
  return <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold", className)}>{letter}</span>
}

/** The band's picture, or the first letter of its name on the accent. */
function Logo() {
  const data = useData()
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-base font-semibold text-primary-foreground">
      {(data.bandName || "B")[0]}
    </span>
  )
}

function Side({ onGo }: { onGo?: () => void }) {
  const data = useData()
  const account = useAccount()
  const me = memberOf(data, data.me)!
  const open = data.marks.filter((k) => !k.closed).length
  const members = data.members.filter((m) => !m.unconfirmed).length
  return (
    <aside className={cn("flex shrink-0 flex-col gap-5 bg-panel p-3", onGo ? "h-full w-64" : "w-56")}>
      <div className="flex items-center gap-3 px-2 pt-1">
        <Logo />
        <div className="min-w-0">
          <div className={cn("truncate font-semibold", !data.bandName && "text-muted-foreground")}>{data.bandName || "Band name"}</div>
          <div className="text-xs text-muted-foreground">{members} members</div>
        </div>
      </div>
      <nav aria-label="Sections" className="flex flex-col gap-0.5">
        {NAV.map(([to, label, Icon]) => (
          <Button key={to} asChild variant="ghost" className="h-9 justify-start gap-3 px-3">
            <Link to={to} onClick={onGo} activeOptions={{ exact: to === "/" }} activeProps={{ className: "bg-selected hover:bg-selected dark:hover:bg-selected" }}>
              <Icon className="text-muted-foreground" />
              {label}
              {to === "/marks" && open > 0 && <span className="tnum ml-auto text-xs text-muted-foreground">{open}</span>}
            </Link>
          </Button>
        ))}
      </nav>
      <span className="flex-1" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-10 justify-start gap-2 px-2">
            <Avatar letter={me.initial} />
            {me.name}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-52">
          <DropdownMenuItem onSelect={account.rename}>Change your name</DropdownMenuItem>
          <DropdownMenuItem onSelect={account.signOut}>Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </aside>
  )
}

/** The player at the bottom: what plays, where it is, a mark there, your star. */
function PlayerBar() {
  const data = useData()
  const p = usePlayer()
  const { open } = usePanel()
  const t = takeOf(data, p.uid)
  const at = useAt(p.uid)
  return (
    <footer className="grid h-16 shrink-0 items-center gap-4 border-t bg-panel px-3" style={{ gridTemplateColumns: "13rem minmax(0,1fr) auto" }}>
      <div className="flex min-w-0 items-center gap-3 pl-1">
        <PlayButton look={p.playing ? "playing" : "idle"} name={t.song ?? "Take"} onClick={() => p.play(p.uid)} className="size-10" />
        <div className="min-w-0">
          <TakeLink uid={p.uid} />
          <div className="text-xs text-muted-foreground">{dayOf(data, t.day).short}</div>
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-3">
        <span className="tnum text-xs text-muted-foreground">{fmt(at)}</span>
        <div
          className="relative h-1.5 flex-1 cursor-pointer rounded-full bg-muted"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            p.seek(p.uid, Math.round(((e.clientX - r.left) / r.width) * t.len))
          }}
        >
          <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${(at / t.len) * 100}%` }} />
        </div>
        <span className="tnum text-xs text-muted-foreground">{fmt(t.len)}</span>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="row" onClick={() => open({ kind: "take", uid: p.uid, markAt: at })}>
          Mark
        </Button>
        <StarButton take={t} />
      </div>
    </footer>
  )
}

/** The panel from the right, as the app's Sheet: 28 rem, over the page, no veil, so the page stays live. */
function PanelView() {
  const { panel } = usePanel()
  const wide = useWide()
  if (!panel) return null
  return (
    <aside
      key={JSON.stringify(panel)}
      className={cn(
        "absolute inset-y-0 right-0 z-20 flex flex-col overflow-y-auto border-l bg-panel p-5 text-sm shadow-lg animate-in slide-in-from-right duration-200",
        wide === "phone" ? "w-full border-l-0" : "w-[28rem] max-w-[calc(100%-3rem)]",
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

/** On a phone: a thin line of where the take is, ▶, the take, the time, Mark. */
function PhoneBar() {
  const data = useData()
  const p = usePlayer()
  const { open } = usePanel()
  const t = takeOf(data, p.uid)
  const at = useAt(p.uid)
  return (
    <footer className="relative shrink-0 border-t bg-panel">
      <div className="absolute inset-x-0 -top-px h-0.5 bg-primary" style={{ right: `${100 - (at / t.len) * 100}%` }} />
      <div className="flex h-14 items-center gap-3 px-3">
        <PlayButton look={p.playing ? "playing" : "idle"} name={t.song ?? "Take"} onClick={() => p.play(p.uid)} className="size-10" />
        <TakeLink uid={p.uid} className="min-w-0" />
        <span className="tnum flex-1 text-xs text-muted-foreground">
          {fmt(at)} / {fmt(t.len)}
        </span>
        <Button variant="outline" size="row" onClick={() => open({ kind: "take", uid: p.uid, markAt: at })}>
          Mark
        </Button>
      </div>
    </footer>
  )
}

export function Shell() {
  const wide = useWide()
  const data = useData()
  const { close } = usePanel()
  // A panel belongs to the page it was opened on.
  const path = useRouterState({ select: (s) => s.location.pathname })
  useEffect(() => close(), [path])
  const navigate = useNavigate()
  useEffect(() => {
    close()
    void navigate({ to: "/" })
  }, [data.fresh])
  const [menu, setMenu] = useState(false)
  const bar = data.takes.length > 0
  if (wide === "phone")
    return (
      <div className="flex h-full flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-panel px-2">
          <Button variant="ghost" size="icon" aria-label="Menu" onClick={() => setMenu(true)}>
            <Menu className="size-5" />
          </Button>
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">{(data.bandName || "B")[0]}</span>
          <span className={cn("truncate font-semibold", !data.bandName && "text-muted-foreground")}>{data.bandName || "Band name"}</span>
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
        <main className="min-w-0 flex-1 overflow-y-auto bg-background px-8 py-8 text-sm">
          <Outlet />
        </main>
        <PanelView />
      </div>
      {bar && <PlayerBar />}
    </div>
  )
}
