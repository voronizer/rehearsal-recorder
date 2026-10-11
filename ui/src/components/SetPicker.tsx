import { useEffect, useState } from "react"
import { ChevronDown, ListMusic, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogButtons,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SetSongsEditor } from "@/components/SetEditor"
import { api, type SongChoices, type SongSet } from "@/lib/api"
import { asSetSongs } from "@/lib/setSongs"
import { focusIsLeftover } from "@/hooks/useSpacebar"

// The set a rehearsal plays by, picked on the start screen beside Start
// rehearsal, and a new one made from there (issue #12 step 8, S1–S3).

const songsLabel = (n: number) => (n === 1 ? "1 song" : `${n} songs`)

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
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="footer"
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
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={6}
        aria-label="Sets"
        aria-labelledby={undefined}
        data-set-menu
        className="w-72 max-h-[min(28rem,var(--radix-dropdown-menu-content-available-height))]"
      >
        <DropdownMenuRadioGroup
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
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onNew}>
          <Plus />
          New set…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Choice({ value, label, detail }: { value: string; label: string; detail?: string }) {
  return (
    <DropdownMenuRadioItem value={value} title={label}>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {detail && <span className="shrink-0 text-xs text-muted-foreground">{detail}</span>}
    </DropdownMenuRadioItem>
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="tall" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>New set</DialogTitle>
        </DialogHeader>
        {/* Scrolls inside the window, which is hung from the top and grows
            down, so the name never moves as the songs come in. */}
        <div className="-mx-6 flex min-h-0 flex-col gap-5 overflow-y-auto px-6 pb-1">
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
        <DialogButtons
          action={
            <Button onClick={() => void create()} disabled={!ok}>
              Create set
            </Button>
          }
        />
      </DialogContent>
    </Dialog>
  )
}
