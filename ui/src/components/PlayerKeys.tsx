import { useState } from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { Keyboard } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useKey } from "@/hooks/useSpacebar"

const overlayClass =
  "fixed inset-0 z-50 bg-black/60 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"

const contentClass =
  "fixed top-1/2 left-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 shadow-lg data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"

const kbdClass =
  "inline-flex h-6 min-w-6 items-center justify-center rounded border bg-background px-1.5 font-mono text-xs"

/**
 * The player's keys, listed behind "?" rather than drawn on its buttons.
 *
 * Drawn on them they were tried twice — a boxed key on each, then a small
 * index in each corner — and both turned a row of small icons into clutter.
 * The transport stays as plain as it was, and anyone who wants the keys asks
 * for them once: with the ? key or the button at the end of the row.
 */
export function PlayerKeys({ spaceKey }: { spaceKey: boolean }) {
  const [open, setOpen] = useState(false)
  useKey("?", () => setOpen(true), !open)

  const rows: [string[], string][] = [
    ...(spaceKey ? [[["Space"], "Play / pause"] as [string[], string]] : []),
    [["←", "→"], "10 seconds back / forward"],
    [["Home"], "To the start"],
    [["M"], "Mark this spot"],
    [["R"], "Repeat on / off"],
  ]

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Player keys"
          aria-keyshortcuts="?"
          title="Keys (?)"
        >
          <Keyboard />
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={overlayClass} />
        <DialogPrimitive.Content className={contentClass}>
          <DialogPrimitive.Title className="text-base font-semibold">
            Keys in the player
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-1 text-xs text-muted-foreground">
            Not while typing a name.
          </DialogPrimitive.Description>
          <dl className="mt-4 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5 text-sm">
            {rows.map(([keys, what]) => (
              <div key={what} className="contents">
                <dt className="flex gap-1">
                  {keys.map((k) => (
                    <kbd key={k} className={kbdClass}>
                      {k}
                    </kbd>
                  ))}
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
