import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { TriangleAlert } from "lucide-react"

import { cn } from "@/lib/utils"

/*
  A line the screen has to say (C8): that a track has no input, that the
  check stopped. It sits where it applies and holds its room, so it moves
  nothing as it comes (B4). `warning` is what is true but not as it should
  be: the theme's warn colour on the icon and the edge, and a faint wash of
  it. `destructive` is for a failure. Both keep the text in its own colour,
  so it reads in both themes.

  `box` is the alert as a block of its own. `line` is for a place that keeps
  one line for whatever it has to say (the player's): no box and no wash,
  the icon in the variant's colour and one line of 12 px words, cut with
  "…" where the room ends. It is 24 px tall whatever it says, so a place can
  hold that room before anything comes. A line cut shows whole through the
  shared WholeTip, which the caller puts round the description. `lines` is
  `line` with room for two, 32 px tall, for words that tell what to do
  next and must not be cut, where a phone has no tip to show them whole
  (the band service's link window).
*/
const alertVariants = cva("relative w-full [&>svg]:text-current", {
  variants: {
    variant: {
      default: "bg-card text-card-foreground",
      warning: "border-warn/40 bg-warn/10 text-foreground [&>svg]:text-warn",
      destructive:
        "bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90 [&>svg]:text-current",
    },
    size: {
      box: "grid grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5",
      line: "flex h-6 items-center gap-x-2 bg-transparent text-xs [&>svg]:size-4 [&>svg]:shrink-0 *:data-[slot=alert-description]:block *:data-[slot=alert-description]:justify-items-normal *:data-[slot=alert-description]:min-w-0 *:data-[slot=alert-description]:truncate *:data-[slot=alert-description]:text-xs *:data-[slot=alert-description]:text-inherit",
      lines:
        "flex h-8 items-start gap-x-2 bg-transparent text-xs [&>svg]:size-4 [&>svg]:shrink-0 *:data-[slot=alert-description]:min-w-0 *:data-[slot=alert-description]:line-clamp-2 *:data-[slot=alert-description]:text-xs *:data-[slot=alert-description]:text-inherit",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "box",
  },
})

function Alert({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      data-size={size ?? "box"}
      role="alert"
      className={cn(alertVariants({ variant, size }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn("col-start-2 line-clamp-1 min-h-4 font-semibold tracking-tight", className)}
      {...props}
    />
  )
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "col-start-2 grid justify-items-start gap-1 text-sm text-muted-foreground [&_p]:leading-relaxed",
        className
      )}
      {...props}
    />
  )
}

/**
 * A warning over a list that stays where it is for as long as it holds, and
 * is not a notice (C8): the `warning` alert with its triangle and one
 * paragraph of words, announced as a status. The start screen's tracks and
 * the unsaved takes both say theirs with it.
 */
function Warning({ children }: { children: React.ReactNode }) {
  return (
    <Alert variant="warning" role="status">
      <TriangleAlert />
      <AlertDescription>
        <p>{children}</p>
      </AlertDescription>
    </Alert>
  )
}

export { Alert, AlertDescription, AlertTitle, Warning }
