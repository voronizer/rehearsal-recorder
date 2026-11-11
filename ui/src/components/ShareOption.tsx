import { useId, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Item } from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { useAfter } from "@/hooks/useAfter"
import { SPINNER_AFTER_MS } from "@/lib/playLook"
import { cn } from "@/lib/utils"

/**
 * One way to hand a take on, as a row that is a button: its icon, its title
 * and a line under it. Share's dialog in РЭХА and the Download dialog in the
 * band service build it the same way (C3).
 */
export function ShareOption({
  icon,
  title,
  hint,
  done,
  busy,
  disabled,
  onClick,
}: {
  icon: ReactNode
  title: string
  hint: string
  done: boolean
  busy: boolean
  disabled: boolean
  onClick: () => void
}) {
  // The icon stays for the first second of a copy (B5).
  const slow = useAfter(busy, SPINNER_AFTER_MS)
  // The button is named by its title alone. "Already there" and the hint are
  // what a screen reader says after the name, in that order.
  const id = useId()
  const thereId = `${id}-there`
  const hintId = `${id}-hint`
  return (
    <Item
      asChild
      variant="outline"
      size="sm"
      className={cn("flex-nowrap items-start", done && "border-signal/40 bg-signal/5")}
    >
      <Button
        type="button"
        variant="ghost"
        onClick={onClick}
        disabled={disabled}
        aria-label={title}
        aria-describedby={done ? `${thereId} ${hintId}` : hintId}
        className="h-auto w-full justify-start text-left whitespace-normal"
      >
        <span className="mt-0.5 shrink-0 text-muted-foreground [&>svg]:size-4">
          {slow ? <Spinner after={0} /> : icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm font-semibold">
            {title}
            {done && (
              <span id={thereId} className="text-xs font-normal text-signal">
                already there
              </span>
            )}
          </span>
          <span id={hintId} className="mt-0.5 block text-xs text-muted-foreground">
            {hint}
          </span>
        </span>
      </Button>
    </Item>
  )
}
