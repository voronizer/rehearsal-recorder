import { useId, type ComponentProps, type ReactNode } from "react"
import { Card } from "@/components/ui/card"
import { rise as riseAt } from "@/lib/motion"
import { cn } from "@/lib/utils"

/** The one slot for what an action in Settings said, so each says over the
 *  last, whichever tab it was on. */
export const SAID = "settings"

/** A titled group can have a hint under its heading and an action at its
 *  right. An untitled one has neither: it has no head to put them in. */
type GroupHead =
  | { title: string; hint?: ReactNode; action?: ReactNode }
  | { title?: undefined; hint?: never; action?: never }

/**
 * One group of a Settings tab: a group on the card's fill (C7), 24 px inside,
 * rising in at its place in the tab (F10; the tab's head is 0). With a title
 * it is a region named by its heading, with the hint under the heading and
 * `action` at its right. A tab with one group, as Appearance, leaves the
 * title out: the tab's head names it already.
 */
export function SettingsGroup({
  title,
  hint,
  action,
  rise,
  className,
  style,
  children,
  ...div
}: GroupHead & {
  /** Its place in the order the tab's groups rise in, from 1. */
  rise: number
} & Omit<ComponentProps<"div">, "title">) {
  const id = useId()
  return (
    <Card
      data-settings-group
      role={title ? "region" : undefined}
      aria-labelledby={title ? id : undefined}
      className={cn("animate-rise gap-6 p-6", className)}
      style={{ ...riseAt(rise), ...style }}
      {...div}
    >
      {title && (
        <div className="flex items-start gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h3 id={id} className="text-base font-semibold">
              {title}
            </h3>
            {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </Card>
  )
}
