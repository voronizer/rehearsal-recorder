import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Toggle as TogglePrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/*
  A button that stays pressed (C8): Check signal, Stereo. On is the grey
  `selected` fill, never the accent (F2), but for M and S: their `tone`
  makes a pressed M the accent blue and a pressed S amber (Alex, 2 Nov
  2026), so a muted or soloed track shows at a glance. It is made like
  Button (C1): the same weight and a 1 px frame in every look, clear when
  it has none to show, so turning it on moves nothing beside it. Its sizes
  are Button's `row` and
  `icon-row`, and its own `lane`, the 20 px square of M and S on a track's
  plate.

  Under the pointer an "on" toggle keeps its fill: only the ones that are off
  answer a hover.
*/
const toggleVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border text-sm font-normal whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 data-[state=on]:bg-selected data-[state=on]:text-foreground not-data-[state=on]:hover:bg-accent not-data-[state=on]:hover:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "border-transparent bg-transparent",
        outline: "border-input bg-transparent shadow-xs",
      },
      size: {
        row: "h-8 px-3 has-[>svg]:px-2.5",
        "icon-row": "size-8",
        // M and S on a track's plate: a small thing, so 4 px.
        lane: "size-5 rounded-sm text-xs",
      },
      tone: {
        plain: "",
        mute: "data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground",
        solo: "data-[state=on]:border-warn data-[state=on]:bg-warn data-[state=on]:text-warn-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "row",
      tone: "plain",
    },
  }
)

function Toggle({
  className,
  variant,
  size,
  tone,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, tone, className }))}
      {...props}
    />
  )
}

// oxlint-disable-next-line react/only-export-components -- ToggleGroup builds its items from the same variants
export { Toggle, toggleVariants }
