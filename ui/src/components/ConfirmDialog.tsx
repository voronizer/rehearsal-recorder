import { useEffect, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogButtons,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { TakeNameField } from "@/components/TakeNameField"
import type { SongChoices, Take } from "@/lib/api"
import { useHeld } from "@/lib/held"

/**
 * The question asked where nothing can be undone (B2): finishing a rehearsal,
 * removing one from history, deleting a label or a set, merging two songs.
 * Enter presses Cancel, so a stray key changes nothing; the action is a verb
 * on a red button when it destroys, on the accent when it only cannot be
 * taken back.
 *
 * `title` and `description` are null when nothing is asked, which is what
 * the state they come from is set to on close: the dialog then keeps the
 * words it had while it fades out.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  actionLabel,
  destructive = true,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string | null | undefined
  description?: ReactNode
  actionLabel: string
  destructive?: boolean
  onConfirm: () => void
}) {
  const asked = useHeld(title, "")
  const said = useHeld(description, null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent {...(said ? {} : { "aria-describedby": undefined })}>
        <DialogHeader>
          <DialogTitle>{asked}</DialogTitle>
          {said && (
            <DialogDescription asChild>
              <div>{said}</div>
            </DialogDescription>
          )}
        </DialogHeader>
        <DialogButtons
          irreversible
          action={
            <Button
              variant={destructive ? "destructive" : "default"}
              onClick={() => {
                onConfirm()
                onOpenChange(false)
              }}
            >
              {actionLabel}
            </Button>
          }
        />
      </DialogContent>
    </Dialog>
  )
}

/** Asking for a single line of text — used for renaming. */
export function PromptDialog({
  open,
  onOpenChange,
  title,
  label,
  initialValue,
  actionLabel = "Rename",
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** A line under the title, saying what renaming does. */
  label?: string
  initialValue: string
  actionLabel?: string
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent {...(label ? {} : { "aria-describedby": undefined })}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {label && <DialogDescription>{label}</DialogDescription>}
        </DialogHeader>
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
        <DialogButtons
          action={
            <Button onClick={submit} disabled={!value.trim()}>
              {actionLabel}
            </Button>
          }
        />
      </DialogContent>
    </Dialog>
  )
}

/**
 * Rename take: the take's name in the field it was named in before and after
 * recording, at the dialog's size, with the songs under it. ✕ puts back the
 * name it has now; Enter renames, as Rename does.
 *
 * A take kept already (`take`) has a folder on disk, renamed with it. The
 * take on the screen after it (`draft`, issue #12 step 8, A4) has none yet,
 * and its ✕ puts back the name it would have had; closed, the keyboard goes
 * back to that screen, whose Space saves the take.
 */
export function RenameTakeDialog({
  take,
  draft,
  choices,
  onOpenChange,
  onSubmit,
}: {
  take?: Take | null
  draft?: { name: string; fallback: string } | null
  choices: SongChoices | null
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string) => void
}) {
  const renaming = take
    ? {
        key: take.take_number,
        name: take.song ?? take.name,
        fallback: take.song ?? take.name,
        id: "rename-take",
        note: "The folder on disk is renamed too." as string | null,
        draft: false,
      }
    : draft
      ? { key: "draft", name: draft.name, fallback: draft.fallback, id: "take-name", note: null, draft: true }
      : null
  // What it shows while it closes, with `take` and `draft` already gone.
  const shown = useHeld(renaming, null)
  return (
    <Dialog open={renaming !== null} onOpenChange={onOpenChange}>
      <DialogContent
        {...(shown?.note ? {} : { "aria-describedby": undefined })}
        onCloseAutoFocus={shown?.draft ? (e) => e.preventDefault() : undefined}
      >
        <DialogHeader>
          <DialogTitle>Rename take</DialogTitle>
          {shown?.note && <DialogDescription>{shown.note}</DialogDescription>}
        </DialogHeader>
        {/* Keyed by the take, so a second take opened starts from its own name. */}
        {shown && (
          <RenameTakeForm
            key={shown.key}
            id={shown.id}
            name={shown.name}
            fallback={shown.fallback}
            choices={choices}
            onSubmit={(name) => {
              onSubmit(name)
              onOpenChange(false)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function RenameTakeForm({
  id,
  name: initial,
  fallback,
  choices,
  onSubmit,
}: {
  id: string
  name: string
  fallback: string
  choices: SongChoices | null
  onSubmit: (name: string) => void
}) {
  const [name, setName] = useState(initial)
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <TakeNameField
        id={id}
        label="Take name"
        size="compact"
        autoFocus
        value={name}
        fallback={fallback}
        choices={choices}
        onCommit={setName}
        onEnter={onSubmit}
      />
      <DialogButtons action={<Button onClick={() => onSubmit(name)}>Rename</Button>} />
    </div>
  )
}
