import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

/*
  Variants say what a button is for: `default` is the one main action (the
  accent), `strong` is the text's own colour (Stop is neutral, not blue),
  `destructive` is for what cannot be brought back. The filled three are
  semibold and the rest regular, so a filled button reads as filled even in
  greyscale.

  Sizes are named for their place, not their height: the footer's big
  button, the aside next to it, a list row's, a row's icon. Every size is a
  control and takes the control radius (8 px) except the lane's M and S,
  which are small things (4 px).

  A key chip (Kbd) on a button sits a little further from the label than an
  icon does, so the key reads as a note on the button, not as part of its name.
*/
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 text-sm whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&>kbd]:ml-1",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground font-semibold hover:bg-primary/90",
        strong:
          "bg-strong text-strong-foreground font-semibold hover:bg-strong/90",
        destructive:
          "bg-destructive text-destructive-foreground font-semibold hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
        outline:
          "border bg-background font-normal shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        ghost:
          "font-normal hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "font-normal text-foreground underline decoration-current/40 decoration-1 underline-offset-4 hover:decoration-current",
      },
      size: {
        default: "h-9 rounded-md px-4 py-2 has-[>svg]:px-3",
        // A button in a list row or beside a field.
        row: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        // The screen's big button, in its footer (Record, Stop, Start).
        footer: "h-14 rounded-md px-10 text-base has-[>svg]:px-8 [&_svg:not([class*='size-'])]:size-5",
        // The footer's other buttons, beside the big one.
        "footer-aside": "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9 rounded-md",
        "icon-row": "size-8 rounded-md",
        "icon-tiny": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        // The player's transport.
        player: "size-10 rounded-md",
        // M and S on a track's lane: a small thing, so 4 px.
        lane: "size-5 rounded-sm text-xs",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
