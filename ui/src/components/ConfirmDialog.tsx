import { useEffect, useState, type ReactNode } from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TakeNameField } from "@/components/TakeNameField"
import type { SongChoices, Take } from "@/lib/api"

const overlayClass =
  "fixed inset-0 z-50 bg-black/60 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"

const contentClass =
  "fixed top-1/2 left-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 shadow-lg data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"

/**
 * Confirming something irreversible. A component of its own because deleting
 * a rehearsal recording is exactly the case where a stray click is expensive,
 * and the built-in confirm() is best left alone inside a webview.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  destructive = true,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={overlayClass} />
        <DialogPrimitive.Content className={contentClass}>
          <DialogPrimitive.Title className="text-base font-semibold">
            {title}
          </DialogPrimitive.Title>
          {description && (
            <DialogPrimitive.Description asChild>
              <div className="mt-2 text-sm text-muted-foreground">
                {description}
              </div>
            </DialogPrimitive.Description>
          )}
          <div className="mt-6 flex justify-end gap-3">
            <DialogPrimitive.Close asChild>
              <Button variant="ghost">{cancelLabel}</Button>
            </DialogPrimitive.Close>
            <Button
              variant={destructive ? "destructive" : "default"}
              onClick={() => {
                onConfirm()
                onOpenChange(false)
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/** Asking for a single line of text — used for renaming. */
export function PromptDialog({
  open,
  onOpenChange,
  title,
  label,
  initialValue,
  confirmLabel = "Rename",
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  label?: string
  initialValue: string
  confirmLabel?: string
  onSubmit: (value: string) => void
}) {
  const [value, setValue] = useState(initialValue)

  useEffect(() => {
    if (open) setValue(initialValue)
  }, [open, initialValue])

  const submit = () => {
    const trimmed = value.trim()
    if (!trimmed) return
    onSubmit(trimmed)
    onOpenChange(false)
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={overlayClass} />
        <DialogPrimitive.Content className={contentClass}>
          <DialogPrimitive.Title className="text-base font-semibold">
            {title}
          </DialogPrimitive.Title>
          <div className="mt-4 flex flex-col gap-2">
            {label && (
              <span className="text-xs text-muted-foreground">{label}</span>
            )}
            <Input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  submit()
                }
              }}
            />
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <DialogPrimitive.Close asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogPrimitive.Close>
            <Button onClick={submit} disabled={!value.trim()}>
              {confirmLabel}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/**
 * Rename take: the take's name in the field it was named in before and after
 * recording, at the dialog's size, with the songs under it. ✕ puts back the
 * name it has now; Enter renames, as Rename does.
 */
export function RenameTakeDialog({
  take,
  choices,
  onOpenChange,
  onSubmit,
}: {
  take: Take | null
  choices: SongChoices | null
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string) => void
}) {
  return (
    <DialogPrimitive.Root open={take !== null} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={overlayClass} />
        <DialogPrimitive.Content className={contentClass}>
          <DialogPrimitive.Title className="text-base font-semibold">
            Rename take
          </DialogPrimitive.Title>
          {/* Keyed by the take, so a second take opened starts from its own name. */}
          {take && (
            <RenameTakeForm
              key={take.take_number}
              take={take}
              choices={choices}
              onSubmit={(name) => {
                onSubmit(name)
                onOpenChange(false)
              }}
            />
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function RenameTakeForm({
  take,
  choices,
  onSubmit,
}: {
  take: Take
  choices: SongChoices | null
  onSubmit: (name: string) => void
}) {
  const [name, setName] = useState(take.name)
  return (
    <div className="mt-4 flex flex-col gap-4">
      <span className="text-xs text-muted-foreground">The folder on disk is renamed too.</span>
      <TakeNameField
        id="rename-take"
        label="Take name"
        size="compact"
        autoFocus
        value={name}
        fallback={take.name}
        choices={choices}
        onCommit={setName}
        onEnter={onSubmit}
      />
      {/* As PromptDialog draws them. */}
      <div className="mt-2 flex justify-end gap-3">
        <DialogPrimitive.Close asChild>
          <Button variant="ghost">Cancel</Button>
        </DialogPrimitive.Close>
        <Button onClick={() => onSubmit(name)}>Rename</Button>
      </div>
    </div>
  )
}
