import { useEffect, useState } from "react"
import { Dialog as DialogPrimitive, DropdownMenu } from "radix-ui"
import { Check, ChevronDown, ListMusic, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { contentClass, overlayClass } from "@/components/ConfirmDialog"
import { SetSongsEditor } from "@/components/SetEditor"
import { api, type SongChoices, type SongSet } from "@/lib/api"
import { asSetSongs } from "@/lib/setSongs"
import { focusIsLeftover } from "@/hooks/useSpacebar"
import { cn } from "@/lib/utils"

// The set a rehearsal plays by, picked on the start screen beside Start
// rehearsal, and a new one made from there (issue #12 step 8, S1–S3).

const songsLabel = (n: number) => (n === 1 ? "1 song" : `${n} songs`)

const ITEM =
  "flex w-full cursor-default items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm outline-none select-none " +
  "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"

/**
 * The button left of Start rehearsal, as tall as it: the set Start plays
 * by, or *No set*. Its menu opens over it: *No set: play freely*, each set
 * with its songs counted, and *New set…*. A long name is cut and shown
 * whole on hover; more sets than fit scroll.
 */
export function SetPicker({
  sets,
  chosen,
  onChoose,
  onNew,
}: {
  sets: SongSet[]
  chosen: number | null
  onChoose: (id: number | null) => void
  onNew: () => void
}) {
  const name = sets.find((s) => s.id === chosen)?.name ?? null
  return (
    // Not modal: New set… opens a window as the menu closes, and a modal
    // menu closing would take the keyboard back to this button from it.
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <Button
          variant="outline"
          size="xl"
          data-set-picker
          title={name ?? "Play freely, or pick a set"}
          // Focus the mouse left here (a set picked, the menu shut) is not
          // aimed at it: Space starts the rehearsal, as with any button.
          onKeyDown={(e) => {
            if (e.key === " " && focusIsLeftover(e.currentTarget)) e.preventDefault()
          }}
          className="max-w-[18rem] px-5 has-[>svg]:px-5"
        >
          <ListMusic />
          <span data-set-name className="min-w-0 truncate">
            {name ?? "No set"}
          </span>
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={6}
          aria-label="Sets"
          aria-labelledby={undefined}
          data-set-menu
          className={cn(
            "z-50 w-72 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md",
            "max-h-[min(28rem,var(--radix-dropdown-menu-content-available-height))]",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          )}
        >
          <DropdownMenu.RadioGroup
            value={chosen === null ? "" : String(chosen)}
            onValueChange={(v) => onChoose(v === "" ? null : Number(v))}
          >
            <Choice value="" label="No set: play freely" />
            {sets.map((s) => (
              <Choice
                key={s.id}
                value={String(s.id)}
                label={s.name}
                detail={songsLabel(s.songs.length)}
              />
            ))}
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item className={ITEM} onSelect={onNew}>
            <Plus className="size-4 shrink-0" />
            New set…
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function Choice({ value, label, detail }: { value: string; label: string; detail?: string }) {
  return (
    <DropdownMenu.RadioItem value={value} title={label} className={ITEM}>
      <span className="flex size-4 shrink-0 items-center justify-center">
        <DropdownMenu.ItemIndicator>
          <Check className="size-4" />
        </DropdownMenu.ItemIndicator>
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {detail && <span className="shrink-0 text-xs text-muted-foreground">{detail}</span>}
    </DropdownMenu.RadioItem>
  )
}

/**
 * *New set…*: a small window over the start screen, so it is not left.
 * *Create set* needs a name and a song; a name another set has is refused,
 * and the window says so until the name changes. Made, the set is chosen
 * (`onCreated` hears the sets and the new one's id).
 */
export function NewSetDialog({
  open,
  onOpenChange,
  choices,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The band's songs, for Add. */
  choices: SongChoices | null
  onCreated: (sets: SongSet[], id: number) => void
}) {
  const [name, setName] = useState("")
  const [titles, setTitles] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName("")
    setTitles([])
    setError(null)
  }, [open])

  const ok = name.trim() !== "" && titles.length > 0 && !busy
  const create = async () => {
    if (!ok) return
    setBusy(true)
    const res = await api().add_set(name, titles)
    setBusy(false)
    if (!res.ok || !res.sets?.length) {
      setError(res.error ?? "Could not make the set")
      return
    }
    // A new set has the highest id there is: SQLite gives a row one past
    // the highest.
    onCreated(res.sets, Math.max(...res.sets.map((s) => s.id)))
    onOpenChange(false)
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={overlayClass} />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // Hung from near the top rather than centred, so it does not move
          // as the songs come in and as they are added: it grows down.
          className={cn(
            contentClass,
            "top-[8vh] flex max-h-[84vh] max-w-lg translate-y-0 flex-col"
          )}
        >
          <DialogPrimitive.Title className="text-base font-semibold">New set</DialogPrimitive.Title>
          <div className="-mx-6 mt-4 flex min-h-0 flex-col gap-5 overflow-y-auto px-6 pb-1">
            <div className="flex flex-col gap-2">
              {/* As in Settings › Sets: what is wrong with the name is said
                  beside it, so the songs under it never move. */}
              <div className="flex h-3.5 min-w-0 items-center gap-2">
                <Label htmlFor="new-set-name" className="shrink-0">
                  Name
                </Label>
                {error && (
                  <p title={error} className="min-w-0 truncate text-sm text-destructive">
                    · {error}
                  </p>
                )}
              </div>
              <Input
                id="new-set-name"
                autoFocus
                value={name}
                maxLength={40}
                placeholder="Gig on the 25th"
                aria-invalid={error !== null}
                onChange={(e) => {
                  setName(e.target.value)
                  setError(null)
                }}
              />
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Songs, in the order you play them</span>
              <SetSongsEditor
                songs={asSetSongs(titles, choices)}
                choices={choices}
                onChange={setTitles}
              />
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <DialogPrimitive.Close asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogPrimitive.Close>
            <Button onClick={() => void create()} disabled={!ok}>
              Create set
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
