import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react"
import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router"

/**
 * What the panel from the right holds: one mark of a take (`id`) or a new
 * one at `at`, a take's marks alone, as the drawer on the take's page has
 * them (shell/drawer.tsx), or the band's statuses or labels, edited over
 * the page (Alex, 2026-11-10). A take itself opens its page: the panel drew
 * the same take with less on it.
 */
export type Panel =
  | { kind: "mark"; uid: string; id?: number; at?: number }
  | { kind: "marks"; uid: string }
  | { kind: "statuses" }
  | { kind: "labels" }
  | null

const moment = (at: number) => String(Math.round(at * 100) / 100)

/**
 * The panel as it is written in the address, `?panel=mark:…`: so the
 * browser's Back and a phone's back gesture close it rather than leave the
 * page, a link can open it, and a reload keeps it.
 */
export function panelText(p: Exclude<Panel, null>): string {
  switch (p.kind) {
    case "mark":
      return p.id === undefined ? `mark:${p.uid}@${moment(p.at ?? 0)}` : `mark:${p.uid}:${p.id}`
    case "marks":
      return `marks:${p.uid}`
    case "statuses":
    case "labels":
      return p.kind
  }
}

/**
 * The panel an address names; anything else is no panel. An older address
 * with a song in the panel (`song:3`) opens the page alone: a song is on its
 * own page now. A take's (`take:…`) opens the take's page, by
 * takeOfOldPanel.
 */
export function panelOf(text: unknown): Panel {
  if (typeof text !== "string") return null
  if (text === "statuses" || text === "labels") return { kind: text }
  const [kind, rest = ""] = [text.slice(0, text.indexOf(":")), text.slice(text.indexOf(":") + 1)]
  const [head, at] = rest.split("@")
  const n = (v: string | undefined) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : undefined)
  if (!head) return null
  if (kind === "marks") return at === undefined ? { kind: "marks", uid: head } : null
  if (kind === "mark") {
    const [uid, id] = head.split(":")
    if (!uid) return null
    if (n(id) !== undefined) return { kind: "mark", uid, id: n(id) }
    return { kind: "mark", uid, at: n(at) ?? 0 }
  }
  return null
}

/** The take an older address had in the panel, `take:<uid>` or `take:<uid>@<at>`: its page opens in its place. */
export function takeOfOldPanel(text: unknown): string | undefined {
  if (typeof text !== "string" || !text.startsWith("take:")) return undefined
  return text.slice(5).split("@")[0] || undefined
}

/** How many panels deep this page of history is: 0 on the page itself. */
type Kept = { panelDepth?: number }

type PanelApi = {
  panel: Panel
  /** Opens a panel over the one open now; Back comes back to it. `replace`: in its place. The one open now, pressed again, closes. */
  open: (p: Panel, how?: { replace?: boolean }) => void
  /** Closes the panel, and every panel it was opened from. */
  close: () => void
  /** Back to the panel this one was opened from, when there is one. */
  back?: () => void
}
const PanelCtx = createContext<PanelApi | null>(null)
export const usePanel = () => useContext(PanelCtx)!

/** The panel: one at a time; the same one pressed again, ✕ or Esc closes it. */
export function PanelProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const navigate = useNavigate()
  const text = useRouterState({ select: (s) => (s.location.search as { panel?: unknown }).panel })
  const depth = useRouterState({ select: (s) => (s.location.state as Kept).panelDepth ?? 0 })
  const panel = useMemo(() => panelOf(text), [text])
  const go = (next: string | undefined, replace: boolean, deep: number) =>
    void navigate({
      to: ".",
      search: ((prev: Record<string, unknown>) => ({ ...prev, panel: next })) as never,
      state: ((prev: Record<string, unknown>) => ({ ...prev, panelDepth: deep })) as never,
      replace,
      resetScroll: false,
    })
  // A panel opened here goes back the way it came, so Back after ✕ does not open it again.
  const close = () => (depth > 0 ? router.history.go(-depth) : go(undefined, true, 0))
  const open = (p: Panel, how?: { replace?: boolean }): void => {
    if (!p) return close()
    const next = panelText(p)
    if (typeof text === "string" && next === text) return close()
    if (how?.replace) go(next, true, depth)
    else go(next, false, depth + 1)
  }
  const back = depth > 1 ? () => router.history.back() : undefined

  // A link or bookmark from before: the take's page, in the address's place;
  // the statuses or the labels, once at the top of their page, in the panel.
  const old = takeOfOldPanel(text)
  const edit = useRouterState({ select: (s) => String((s.location.search as { edit?: unknown }).edit ?? "") })
  useEffect(() => {
    if (old) void navigate({ to: "/takes/$uid", params: { uid: old }, replace: true })
    else if (edit === "statuses" || edit === "labels")
      void navigate({ to: ".", search: ((prev: Record<string, unknown>) => ({ ...prev, edit: undefined, panel: edit })) as never, replace: true })
  }, [old, edit, navigate])

  useEffect(() => {
    // Not when Esc closed something inside the panel first (a list, a menu, a
    // question), or leaves a box being typed in.
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || !panel) return
      const t = e.target as HTMLElement | null
      if (t?.closest("input, textarea, select, [contenteditable=true]")) return
      close()
    }
    window.addEventListener("keydown", esc)
    return () => window.removeEventListener("keydown", esc)
  })

  return <PanelCtx.Provider value={{ panel, open, close, back }}>{children}</PanelCtx.Provider>
}
