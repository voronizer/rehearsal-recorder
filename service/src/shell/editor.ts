import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router"

/**
 * `editBack`: how many pages of history back the page is as it was before
 * the editor opened, not counting panels opened over the editor since
 * (`panelDepth`, shell/panel.tsx). None when the editor came with the
 * address itself, as from **Edit statuses** on a song's page.
 */
type Kept = { editBack?: number; panelDepth?: number }

/**
 * Which of a page's editors is open at its top (**Statuses**, **New song**,
 * **Labels**), kept in the address as `?edit=`, as the panel is: Back
 * closes it and a reload keeps it. One at a time: another one opens in its
 * place. An editor and the panel are one layer each: opening an editor
 * closes the panel, and ✕ on the editor closes a panel opened over it too,
 * going back to the page as it was.
 */
export function useEditor<K extends string>(): { edit: K | undefined; toggle: (k: K) => void; close: () => void } {
  const router = useRouter()
  const navigate = useNavigate()
  const edit = useRouterState({ select: (s) => (s.location.search as { edit?: string }).edit }) as K | undefined
  const kept = useRouterState({ select: (s) => s.location.state as Kept })
  const back = kept.editBack ?? 0
  const panels = kept.panelDepth ?? 0
  const go = (next: K | undefined, replace: boolean, state: Kept) =>
    void navigate({
      to: ".",
      search: ((prev: Record<string, unknown>) => ({ ...prev, edit: next, panel: undefined })) as never,
      state: ((prev: Kept) => ({ ...prev, ...state })) as never,
      replace,
      resetScroll: false,
    })
  const close = () => (back > 0 ? router.history.go(-(back + panels)) : go(undefined, true, { editBack: 0, panelDepth: 0 }))
  const open = (k: K) =>
    edit === undefined
      ? // Over the page; a panel open on it is a step further back.
        go(k, false, { editBack: panels + 1, panelDepth: 0 })
      : // In the open one's place; the panels over it become steps of its own.
        go(k, true, { editBack: back && back + panels, panelDepth: 0 })
  return { edit, toggle: (k) => (edit === k ? close() : open(k)), close }
}
