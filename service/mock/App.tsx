import { useEffect, useState, type ReactNode } from "react"
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { AccountCtx, PanelProvider, PlayerProvider, WideCtx } from "./context"
import { change, memberOf, setFresh, useData } from "./data"
import { Home } from "./Home"
import { NameScreen, SignIn } from "./more"
import { Marks, Members, Rehearsal, Rehearsals, Songs, TakePage, Trash } from "./pages"
import { Shell } from "./Shell"
import { Song } from "./Song"

// The service's addresses (service/src/routes.tsx), with the new sections.
const root = createRootRoute({ component: Shell })
const home = createRoute({ getParentRoute: () => root, path: "/", component: Home })
const rehearsals = createRoute({ getParentRoute: () => root, path: "/rehearsals", component: Rehearsals })
const rehearsal = createRoute({ getParentRoute: () => root, path: "/rehearsals/$id", component: Rehearsal })
const songs = createRoute({ getParentRoute: () => root, path: "/songs", component: Songs })
const song = createRoute({ getParentRoute: () => root, path: "/songs/$id", component: Song })
const marks = createRoute({ getParentRoute: () => root, path: "/marks", component: Marks })
const members = createRoute({ getParentRoute: () => root, path: "/members", component: Members })
const trash = createRoute({ getParentRoute: () => root, path: "/trash", component: Trash })
const take = createRoute({ getParentRoute: () => root, path: "/takes/$uid", component: TakePage })
const router = createRouter({
  history: createMemoryHistory({ initialEntries: ["/"] }),
  routeTree: root.addChildren([home, rehearsals, rehearsal, songs, song, marks, members, trash, take]),
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

const SIZES: [number, number][] = [
  [1180, 820],
  [960, 680],
  [390, 844],
]

/** The viewer's theme: the artifact's own choice if any, else the system's. */
function useViewerDark() {
  const read = () => {
    const t = document.documentElement.dataset.theme
    return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches
  }
  const [dark, setDark] = useState(read)
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)")
    const on = () => setDark(read())
    mq.addEventListener("change", on)
    const mo = new MutationObserver(on)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] })
    return () => (mq.removeEventListener("change", on), mo.disconnect())
  }, [])
  return dark
}

function Switch<T extends string | number | boolean>({ label, value, set, options }: { label: string; value: T; set: (v: T) => void; options: [T, string][] }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className="mr-1 text-muted-foreground">{label}</span>
      {options.map(([v, t]) => (
        <button
          key={String(v)}
          type="button"
          aria-pressed={v === value}
          onClick={() => set(v)}
          className={cn("rounded-md border px-2.5 py-1", v === value ? "border-foreground bg-foreground text-background" : "bg-background hover:bg-accent")}
        >
          {t}
        </button>
      ))}
    </span>
  )
}

type Who = "ira" | "alex" | "out"

export function App() {
  const data = useData()
  const viewerDark = useViewerDark()
  const [theme, setTheme] = useState<"auto" | "light" | "dark">("auto")
  const [size, setSize] = useState(0)
  const [who, setWho] = useState<Who>("ira")
  const [naming, setNaming] = useState<"first" | "change" | null>(null)
  const dark = theme === "auto" ? viewerDark : theme === "dark"
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
  }, [dark])
  const pick = (w: Who) => {
    setWho(w)
    setNaming(null)
    if (w !== "out") change(() => ({ me: w, owner: w === "alex" }))
  }
  const [w, h] = SIZES[size]
  const me = memberOf(data, data.me)
  let screen: ReactNode
  if (who === "out") screen = <SignIn done={(needsName) => (needsName ? setNaming("first") : pick("ira"), needsName && setWho("ira"))} />
  if (naming)
    screen = (
      <NameScreen
        initial={naming === "change" ? me?.name : ""}
        done={(name) => (change((s) => ({ members: s.members.map((m) => (m.id === s.me ? { ...m, name, initial: name[0] } : m)) })), setNaming(null))}
        cancel={naming === "change" ? () => setNaming(null) : undefined}
      />
    )
  return (
    <TooltipProvider>
      <div className="flex min-h-full flex-col items-center gap-4 py-4" style={{ paddingInline: "max(16px, env(safe-area-inset-left, 0px))" }}>
        <div className="flex max-w-[1180px] flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
          <Switch label="The band:" value={data.fresh} set={(f) => (setFresh(f), setWho(f ? "alex" : who === "alex" ? "alex" : "ira"))} options={[[false, "Three weeks in"], [true, "Brand new"]]} />
          <Switch label="Signed in as:" value={who} set={pick} options={[["ira", "Ira, a member"], ["alex", "Alex, the owner"], ["out", "Nobody yet"]]} />
          <Switch label="Window:" value={size} set={setSize} options={SIZES.map((s, i) => [i, `${s[0]}×${s[1]}`])} />
          <Switch label="Theme:" value={theme} set={setTheme} options={[["auto", "As yours"], ["light", "Light"], ["dark", "Dark"]]} />
        </div>
        <div className="max-w-full overflow-auto">
          <div className="overflow-hidden rounded-xl border bg-background shadow-lg" style={{ width: w, height: h }}>
              <WideCtx.Provider value={w < 500 ? "phone" : w >= 1100 ? "wide" : "narrow"}>
                <AccountCtx.Provider value={{ rename: () => setNaming("change"), signOut: () => pick("out") }}>
                  <PlayerProvider>
                    <PanelProvider>{screen ?? <RouterProvider router={router} />}</PanelProvider>
                  </PlayerProvider>
                </AccountCtx.Provider>
              </WideCtx.Provider>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
