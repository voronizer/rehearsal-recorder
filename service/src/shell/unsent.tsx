import { useBlocker } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { Dialog, DialogButtons, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useInPanel } from "./parts"

const panelIn = (search: unknown) => (search as { panel?: unknown }).panel

/**
 * Words written and not sent yet, a comment or a mark: leaving them asks
 * first (Alex's pick A, 2026-11-02). In the panel, closing it or opening
 * another asks; on a page, going to another page. Closing the browser's
 * tab asks the browser's own way. Song notes save themselves and need none.
 */
export function KeepWriting({ dirty }: { dirty: boolean }) {
  const inPanel = useInPanel()
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      dirty && (current.pathname !== next.pathname || (inPanel && panelIn(current.search) !== panelIn(next.search))),
    enableBeforeUnload: () => dirty,
    withResolver: true,
  })
  if (blocker.status !== "blocked") return null
  return (
    <Dialog open onOpenChange={(open) => !open && blocker.reset()}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Discard what you wrote?</DialogTitle>
        </DialogHeader>
        <DialogButtons
          cancel="Keep writing"
          irreversible
          action={
            <Button variant="destructive" onClick={blocker.proceed}>
              Discard
            </Button>
          }
        />
      </DialogContent>
    </Dialog>
  )
}
