import * as React from "react"
import { cn } from "@/lib/utils"

/*
  A text area (C8), from shadcn's, on the theme.

  `line` has no frame: a faint line under it says it can be written in, a
  brighter one under the pointer, and the focus ring's colour, twice as thick,
  while it is typed in. The thicker line is a shadow under the field, so
  nothing moves. It is what a name in a row looks like (R4).
*/
const LOOK = {
  default:
    "min-h-16 rounded-md border border-input px-3 py-2 text-base shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:ring-destructive/40",
  line: "min-h-0 resize-none rounded-none border-0 border-b border-muted-foreground/35 px-0 py-1.5 text-sm leading-5 break-words whitespace-pre-wrap selection:bg-primary selection:text-primary-foreground hover:border-muted-foreground focus-visible:border-ring focus-visible:shadow-[0_1px_0_0_var(--color-ring)]",
} as const

function Textarea({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"textarea"> & { variant?: keyof typeof LOOK }) {
  return (
    <textarea
      data-slot="textarea"
      data-variant={variant}
      className={cn(
        "flex field-sizing-content w-full bg-transparent transition-[color,box-shadow] outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
        LOOK[variant],
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
