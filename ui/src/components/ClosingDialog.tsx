import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogButtons,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { api } from "@/lib/api"
import { stillSending } from "@/lib/sending"
import { useHeld } from "@/lib/held"

declare global {
  interface Window {
    /** Python asks this when the window is closed with takes still going to
     *  the band service (BandService.window_closing). */
    __rehaClosing?: () => void
  }
}

/**
 * Closing the window while takes are still going to the band service. The
 * window stays open and asks: Keep sending, or Close anyway, after which
 * the rest goes the next time РЭХА is open, from where it stopped.
 */
export function ClosingDialog() {
  const [left, setLeft] = useState<{ takes: number; bytes: number } | null>(null)
  const shown = useHeld(left, null)

  useEffect(() => {
    window.__rehaClosing = () => {
      // A page that cannot tell what is left cannot ask either: the window
      // closes, as it does when the page does not answer at all
      // (BandService._ask), and the rest goes the next time.
      void api()
        .sending_left()
        .then(
          (now) => setLeft(now.takes > 0 ? now : null),
          () => api().close_anyway()
        )
    }
    return () => {
      delete window.__rehaClosing
    }
  }, [])

  return (
    <Dialog open={left !== null} onOpenChange={(open) => !open && setLeft(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close РЭХА?</DialogTitle>
          <DialogDescription>
            {shown ? stillSending(shown.takes, shown.bytes) : ""} The rest goes the next time РЭХА
            is open.
          </DialogDescription>
        </DialogHeader>
        <DialogButtons
          cancel="Keep sending"
          action={
            <Button
              onClick={() => {
                setLeft(null)
                void api().close_anyway()
              }}
            >
              Close anyway
            </Button>
          }
        />
      </DialogContent>
    </Dialog>
  )
}
