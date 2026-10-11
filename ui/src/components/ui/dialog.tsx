import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"
import { useSystem, type System } from "@/lib/platform"
import { cn } from "@/lib/utils"

/*
  The one dialog (C3), from shadcn's, in the theme: a veil, a 12 px frame on
  the card colour, a 16 px title, and 220 ms in and out (the animate-in and
  animate-out tokens). No ✕: Esc, a click on the veil and Cancel close it.

  Its buttons are DialogButtons, which stand in the order of the system the
  app is on (P3) and say which of them Enter presses: the action, or Cancel
  where nothing can be undone.
*/

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-overlay data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
}

/** How wide a dialog is, and where it hangs. */
const SIZES = {
  default: "max-w-md",
  narrow: "max-w-sm",
  // Hung from near the top rather than centred and growing down, so what is
  // above its end does not move as the content comes in (New set).
  tall: "top-[12vh] max-h-[84vh] max-w-md translate-y-0",
} as const

/** The button Enter presses, marked by DialogButtons. */
const ENTER = "data-enter"

/**
 * Where the keyboard starts when a dialog opens: a field that asked for it
 * (autoFocus, which Radix leaves alone), else the button DialogButtons marked
 * for Enter, else what Radix does: the first control, or the dialog itself.
 */
function focusTheEnterButton(event: Event) {
  const content = event.currentTarget
  if (!(content instanceof HTMLElement)) return
  const wanted =
    content.querySelector<HTMLElement>("[autofocus]") ??
    content.querySelector<HTMLElement>(`[${ENTER}]`)
  if (!wanted) return
  event.preventDefault()
  wanted.focus()
}

function DialogContent({
  className,
  children,
  size = "default",
  showCloseButton = false,
  onOpenAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  /** "narrow" for a list of keys, "tall" for a dialog that grows down. */
  size?: keyof typeof SIZES
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-size={size}
        onOpenAutoFocus={(event) => {
          onOpenAutoFocus?.(event)
          if (!event.defaultPrevented) focusTheEnterButton(event)
        }}
        className={cn(
          "fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border bg-card p-6 shadow-lg outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          SIZES[size],
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-4 right-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-left", className)}
      {...props}
    />
  )
}

/** The row the buttons stand in: at the right, with room above them. */
function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("mt-2 flex shrink-0 items-center justify-end gap-3", className)}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-base font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

/**
 * The buttons of a dialog, in the order of the system (P3): on the Mac the
 * action is rightmost, `Cancel, action`; on Windows it comes first,
 * `action, Cancel`. `aside` stands apart at the far left: what is done to
 * the thing itself (Delete marker, Remove from the cloud) rather than
 * answered.
 *
 * It also says which button Enter presses, by giving it the focus when the
 * dialog opens: the action, or Cancel when `irreversible` (nothing in it can
 * be undone, so a stray Enter must do nothing). A dialog with a field to type
 * in has the focus in the field, and Enter there is the field's.
 *
 * With no `action` the one button is the way out, and `cancel` is its word
 * (Close, for a dialog whose options act at once).
 */
function DialogButtons({
  cancel = "Cancel",
  action,
  aside,
  irreversible = false,
  cancelDisabled = false,
  system,
}: {
  cancel?: string
  /** The action's Button, which says a verb. */
  action?: React.ReactNode
  aside?: React.ReactNode
  /** Nothing in the dialog can be undone: Enter presses Cancel. */
  irreversible?: boolean
  cancelDisabled?: boolean
  /** Be this system's order instead of the app's: for the showcase. */
  system?: System
}) {
  const own = useSystem()
  const windows = (system ?? own) === "windows"
  const enterOnCancel = irreversible || !action

  const cancelButton = (
    <DialogClose asChild>
      <Button variant="ghost" disabled={cancelDisabled} {...(enterOnCancel ? { [ENTER]: "" } : {})}>
        {cancel}
      </Button>
    </DialogClose>
  )
  const actionButton =
    !enterOnCancel && React.isValidElement(action)
      ? React.cloneElement(action as React.ReactElement<Record<string, unknown>>, { [ENTER]: "" })
      : action

  return (
    <DialogFooter>
      {aside && <div className="mr-auto">{aside}</div>}
      {windows ? (
        <>
          {actionButton}
          {cancelButton}
        </>
      ) : (
        <>
          {cancelButton}
          {actionButton}
        </>
      )}
    </DialogFooter>
  )
}

export {
  Dialog,
  DialogButtons,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
