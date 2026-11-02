import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

/**
 * What words that open or play something look like (owner's pick A,
 * 2026-11-02), as in the band service: a grey dotted line under them,
 * solid under the mouse. A song's name, a mark's words, a take's name, a
 * link in a sentence: `link` below, and words inside a bigger button.
 */
const OPENS =
  "underline decoration-muted-foreground/60 decoration-dotted decoration-1 underline-offset-4 hover:decoration-current hover:decoration-solid"

/*
  Variants say what a button is for: `default` is the one main action (the
  accent), `strong` is the text's own colour (Stop is neutral, not blue),
  `destructive` is for what cannot be brought back. Every variant is the same
  weight, regular: a toggle that swaps its pill between default and outline
  would otherwise change width on every click (a heavier word is wider), and
  every pill beside it would shift. The fill carries the emphasis. The same goes
  for the frame: every variant has a 1 px border (clear on all but outline), so
  swapping variants leaves the width alone. A link has none: it is bare words,
  never swapped with a filled button, and a frame would set it 1 px in.

  Sizes are named for their place, not their height: the footer's big
  button, the aside next to it, a list row's, a row's icon. Every size is a
  control and takes the control radius (8 px). M and S on a lane are
  Toggle's `lane`.

  A key chip (Kbd) on a button sits a little further from the label than an
  icon does, so the key reads as a note on the button, not as part of its name.
*/
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 border text-sm font-normal whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&>kbd]:ml-1",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/90",
        strong:
          "border-transparent bg-strong text-strong-foreground hover:bg-strong/90",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:border-destructive focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
        outline:
          "bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        ghost:
          "border-transparent hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        // No frame: bare words sit flush with what is beside them, and a link
        // never swaps with a filled button, so it has no width to keep.
        link: `border-0 text-foreground ${OPENS}`,
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

export { Button, buttonVariants, OPENS }
