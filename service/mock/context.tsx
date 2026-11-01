import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { change, seen, takeOf, useData } from "./data"

/** The window's width class: a computer, a small window, a phone. */
export const WideCtx = createContext<"wide" | "narrow" | "phone">("wide")
export const useWide = () => useContext(WideCtx)

// ---- one player for the whole service: the panel, the pages and the bar ----

type Player = { uid: string; at: number; playing: boolean }
type PlayerApi = Player & { play: (uid: string, at?: number) => void; seek: (uid: string, at: number) => void }
const PlayerCtx = createContext<PlayerApi | null>(null)
export const usePlayer = () => useContext(PlayerCtx)!

export function PlayerProvider({ children }: { children: ReactNode }) {
  const data = useData()
  const [p, setP] = useState<Player>({ uid: "viasna-12", at: 74, playing: false })
  useEffect(() => {
    if (!p.playing) return
    const id = setInterval(() => {
      setP((q) => {
        const len = takeOf(data, q.uid).len
        return q.at + 1 >= len ? { ...q, at: len, playing: false } : { ...q, at: q.at + 1 }
      })
    }, 1000)
    return () => clearInterval(id)
  }, [p.playing, data])
  const play = (uid: string, at?: number) => {
    seen(uid)
    setP((q) => (q.uid === uid && at === undefined ? { ...q, playing: !q.playing } : { uid, at: at ?? (q.uid === uid ? q.at : 0), playing: true }))
  }
  const seek = (uid: string, at: number) => {
    seen(uid)
    setP((q) => ({ uid, at, playing: q.uid === uid ? q.playing : true }))
  }
  return <PlayerCtx.Provider value={{ ...p, play, seek }}>{children}</PlayerCtx.Provider>
}

/** Where the player is in this take: its own spot if it is the one playing. */
export function useAt(uid: string) {
  const p = usePlayer()
  return p.uid === uid ? p.at : 0
}

// ---- the panel from the right ----

export type Panel =
  | { kind: "take"; uid: string; markAt?: number }
  | { kind: "song"; id: string }
  | { kind: "labels" }
  | { kind: "statuses" }
  | { kind: "new-song" }
  | null
type PanelApi = { panel: Panel; open: (p: Panel) => void; close: () => void }
const PanelCtx = createContext<PanelApi | null>(null)
export const usePanel = () => useContext(PanelCtx)!

export function PanelProvider({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<Panel>(null)
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setPanel(null)
    window.addEventListener("keydown", esc)
    return () => window.removeEventListener("keydown", esc)
  }, [])
  const open = (p: Panel) => {
    if (p?.kind === "take") seen(p.uid)
    setPanel((q) => (JSON.stringify(q) === JSON.stringify(p) ? null : p))
  }
  return <PanelCtx.Provider value={{ panel, open, close: () => setPanel(null) }}>{children}</PanelCtx.Provider>
}

export const setMe = (me: string, owner: boolean) => change(() => ({ me, owner }))

/** Changing your name and signing out, from the menu under your name. */
type Account = { rename: () => void; signOut: () => void }
export const AccountCtx = createContext<Account>({ rename: () => {}, signOut: () => {} })
export const useAccount = () => useContext(AccountCtx)
