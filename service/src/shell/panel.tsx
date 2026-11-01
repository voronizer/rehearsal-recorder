import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { usePlayer } from "../takes/player/one"

/** What the panel from the right holds: a take (with a new mark at `markAt`), a song, or one of the band's lists. */
export type Panel =
  | { kind: "take"; uid: string; markAt?: number }
  | { kind: "song"; id: number }
  | { kind: "labels" }
  | { kind: "statuses" }
  | { kind: "new-song" }
  | null

type PanelApi = { panel: Panel; open: (p: Panel) => void; close: () => void }
const PanelCtx = createContext<PanelApi | null>(null)
export const usePanel = () => useContext(PanelCtx)!

/** The panel: one at a time; the same one pressed again, ✕ or Esc closes it. Opening a take makes it heard. */
export function PanelProvider({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<Panel>(null)
  const player = usePlayer()
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setPanel(null)
    window.addEventListener("keydown", esc)
    return () => window.removeEventListener("keydown", esc)
  }, [])
  const open = (p: Panel) => {
    if (p?.kind === "take") player.heard(p.uid)
    setPanel((q) => (JSON.stringify(q) === JSON.stringify(p) ? null : p))
  }
  return <PanelCtx.Provider value={{ panel, open, close: () => setPanel(null) }}>{children}</PanelCtx.Provider>
}
