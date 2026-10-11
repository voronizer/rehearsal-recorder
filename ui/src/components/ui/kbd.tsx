import * as React from "react"
import { cn } from "@/lib/utils"

/*
  The one key chip: a key drawn on the button it presses, or listed in a hint
  or a dialog. From shadcn's kbd, but in the colour of the text around it
  instead of a muted grey: a thin border and a wash of the current colour, so
  the same chip reads on a page and on a filled button (white on the accent,
  dark on a strong Stop).

  A key on a button saves a line of "Space: save take" under it: there is no
  distance between the key and what it does. Show it only while the key really
  does press that button (with a take open on the rehearsal screen Space plays
  it and Escape closes it, so Record and Finish lose theirs), and mark it
  `aria-hidden`, since the button says its key with `aria-keyshortcuts`. A key
  listed in text is content and stays readable.

  The words are the system's: a key that is ⌘ on a Mac and Ctrl elsewhere is
  written with words(useSystem()).mod (lib/platform.ts).
*/
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm border border-current/30 bg-current/10 px-1 font-sans text-xs font-normal select-none",
        "[&_svg:not([class*='size-'])]:size-3",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
