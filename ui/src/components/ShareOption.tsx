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
 * band service build it the same way (C3). `trouble` is said in the line's
 * place, in the error's colour; `progress`, beside the title while it is
 * busy ("Mixing… 40%"), where the spinner is then quiet.
 */
export function ShareOption({
  icon,
  title,
  hint,
  done = false,
  busy = false,
  trouble = null,
  progress = null,
  disabled,
  onClick,
}: {
  icon: ReactNode
  title: string
  hint: string
  done?: boolean
  busy?: boolean
  trouble?: string | null
  progress?: string | null
  disabled: boolean
  onClick: () => void
}) {
  // The icon stays for the first second of a copy or a mix (B5).
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
          {/* Quiet where its words beside it say it. */}
          {slow ? <Spinner after={0} quiet={!!progress} /> : icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm font-semibold">
            {title}
            {done && (
              <span id={thereId} className="text-xs font-normal text-signal">
                already there
              </span>
            )}
            {slow && progress && <span className="text-xs font-normal text-muted-foreground">{progress}</span>}
          </span>
          <span id={hintId} role={trouble ? "alert" : undefined} className={cn("mt-0.5 block text-xs", trouble ? "text-destructive" : "text-muted-foreground")}>
            {trouble ?? hint}
          </span>
        </span>
      </Button>
    </Item>
  )
}
