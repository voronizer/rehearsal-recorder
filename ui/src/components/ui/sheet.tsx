import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as SheetPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"
import { DialogOverlay, leaveNoticesAlone } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

/*
  The sheet (C8), from shadcn's, in the theme: a panel that slides in from one
  side, the full height of the window, on the same Radix dialog as the Dialog.
  Esc, a click on the veil and the ✕ close it, and the focus goes back to the
  button that opened it (give the Sheet a SheetTrigger, or send it there with
  onCloseAutoFocus when the button is elsewhere).

  It stands behind the notices as the Dialog does (C4): the veil is the
  Dialog's, with its z-50, and a click on a notice is not a click outside.
  It slides in over 220 ms, off under Reduce motion and while a take records
  (F11), like every dialog. It is 28 rem wide, and never wider than the window
  less 3 rem, so the screen shows past it.
*/

function Sheet(props: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger(props: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose(props: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  onInteractOutside,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "left" | "right"
  /** The row with ✕ at the top; Esc closes the sheet either way. */
  showCloseButton?: boolean
}) {
  return (
    <SheetPrimitive.Portal>
      <DialogOverlay data-slot="sheet-overlay" />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        onInteractOutside={(event) => {
          onInteractOutside?.(event)
          leaveNoticesAlone(event)
        }}
        className={cn(
          "fixed inset-y-0 z-50 flex w-[28rem] max-w-[calc(100vw-3rem)] flex-col bg-panel shadow-lg outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
          side === "left"
            ? "left-0 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left"
            : "right-0 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
          className
        )}
        {...props}
      >
        {showCloseButton && (
          <div className="flex shrink-0 justify-end px-3 pt-3">
            <SheetPrimitive.Close asChild>
              <Button variant="ghost" size="icon-row" aria-label="Close">
                <XIcon />
              </Button>
            </SheetPrimitive.Close>
          </div>
        )}
        {children}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-2 px-8 pt-1 pb-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 px-8 py-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-base font-semibold text-foreground", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
}
