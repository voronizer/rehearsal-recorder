import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router"

/**
 * `editOpened`: this page of history was made by opening the editor on the
 * page as it was, so ✕ can go back to it. `panelDepth` is the panel's
 * (shell/panel.tsx): how many panels were opened over it since.
 */
type Kept = { editOpened?: boolean; panelDepth?: number }

/**
 * Which of a page's editors is open at its top (**Statuses**, **New song**,
 * **Labels**), kept in the address as `?edit=`, as the panel is: Back
 * closes it and a reload keeps it. One at a time: another one opens in its
 * place, so Back and ✕ go straight back to the page.
 */
export function useEditor<K extends string>(): { edit: K | undefined; toggle: (k: K) => void; close: () => void } {
  const router = useRouter()
  const navigate = useNavigate()
  const edit = useRouterState({ select: (s) => (s.location.search as { edit?: string }).edit }) as K | undefined
  const kept = useRouterState({ select: (s) => s.location.state as Kept })
  const go = (next: K | undefined, replace: boolean, state: Kept = {}) =>
    void navigate({
      to: ".",
      search: ((prev: Record<string, unknown>) => ({ ...prev, edit: next, ...(replace ? {} : { panel: undefined }) })) as never,
      state: ((prev: Kept) => ({ ...prev, ...state })) as never,
      replace,
      resetScroll: false,
    })
  // Back past the editor and any panel opened over it since. An editor that
  // opened in a panel's place only leaves: Back would bring the panel again.
  const close = () => (kept.editOpened ? router.history.go(-1 - (kept.panelDepth ?? 0)) : go(undefined, true))
  const open = (k: K) => {
    // Another editor: in this one's place.
    if (edit !== undefined) return go(k, true)
    // Over the page, the panel open on it closed.
    const panel = (router.state.location.search as { panel?: unknown }).panel !== undefined
    go(k, false, { editOpened: !panel, panelDepth: 0 })
  }
  return { edit, toggle: (k) => (edit === k ? close() : open(k)), close }
}
