import { useRef, useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { SetSongsEditor } from "@/components/SetEditor"
import { useSets } from "@/hooks/useSets"
import { useSongChoices } from "@/hooks/useSongChoices"
import { api, type SetsAnswer, type SongChoices, type SongSet } from "@/lib/api"
import { dismiss, notify } from "@/lib/notices"
import { asSetSongs } from "@/lib/setSongs"
import { cn } from "@/lib/utils"

// What a change here said — one slot, so each says over the last.
const SAID = "sets"

const songsLabel = (n: number) => (n === 1 ? "1 song" : `${n} songs`)

/** A name no set has yet: "New set", then "New set 2", and on. */
function freeName(sets: SongSet[]) {
  const taken = new Set(sets.map((s) => s.name.toLocaleLowerCase()))
  if (!taken.has("new set")) return "New set"
  for (let i = 2; ; i++) if (!taken.has(`new set ${i}`)) return `New set ${i}`
}

/**
 * Settings › Sets (issue #12 step 8, T1–T5): the sets down the left, each
 * with its songs counted, and *New set* under them; the one picked in the
 * list beside them, its name and its songs changed in place and saved at
 * once, as the rest of Settings is. On a narrow window it goes under the
 * list. Which set Start plays by is chosen beside Start rehearsal, not
 * here.
 */
export function SetsSettings() {
  const { sets, chosen, replace } = useSets()
  const [picked, setPicked] = useState<number | null>(null)
  // The set just made: its name is selected, to be typed over.
  const [fresh, setFresh] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<SongSet | null>(null)
  const choices = useSongChoices(true, null, null)

  const set =
    sets.find((s) => s.id === picked) ?? sets.find((s) => s.id === chosen) ?? sets[0] ?? null

  /** Applies what a change answered; says why when it was refused.
   *  Returns the error, or null when it went through. */
  const answered = (res: SetsAnswer): string | null => {
    if (!res.ok) return res.error ?? "Could not change the set"
    dismiss(SAID)
    if (res.sets) replace(res.sets)
    return null
  }

  const add = async () => {
    const res = await api().add_set(freeName(sets), [])
    const error = answered(res)
    if (error) {
      notify({ key: SAID, kind: "error", text: error })
      return
    }
    // A new set has the highest id there is (SetPicker's NewSetDialog).
    const id = Math.max(...(res.sets ?? []).map((s) => s.id))
    setPicked(id)
    setFresh(id)
  }

  const saveSongs = async (of: SongSet, titles: string[]) => {
    // In place at once, so a dragged row stays where it was dropped.
    const kept = new Map(of.songs.map((s) => [s.title, s]))
    const songs = asSetSongs(titles, choices).map((s) => kept.get(s.title) ?? s)
    replace(sets.map((s) => (s.id === of.id ? { ...s, songs } : s)))
    const error = answered(await api().update_set(of.id, null, titles))
    if (error) {
      notify({ key: SAID, kind: "error", text: error })
      replace(await api().list_sets())
    }
  }

  const remove = async (of: SongSet) => {
    const error = answered(await api().delete_set(of.id))
    if (error) notify({ key: SAID, kind: "error", text: error })
    else setPicked(null)
  }

  return (
    <section className="grid items-start gap-6 min-[900px]:grid-cols-[13rem_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-2">
        {sets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No sets yet. A set is the songs a rehearsal goes through, in order. Pick one beside
            Start rehearsal, or play freely as before.
          </p>
        ) : (
          <ul aria-label="Sets" className="flex flex-col gap-1">
            {sets.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  data-set-item={s.name}
                  title={s.name}
                  aria-current={s.id === set?.id ? "true" : undefined}
                  onClick={() => setPicked(s.id)}
                  className={cn(
                    "flex w-full min-w-0 flex-col items-start rounded-lg px-3 py-2 text-left transition-colors",
                    "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                    s.id === set?.id ? "bg-accent" : "hover:bg-accent/50"
                  )}
                >
                  <span className="w-full truncate text-sm font-medium">{s.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {songsLabel(s.songs.length)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button variant="ghost" size="sm" className="self-start" onClick={() => void add()}>
          <Plus />
          New set
        </Button>
      </div>

      {set && (
        <SetDetail
          // Another set, another name being typed.
          key={set.id}
          set={set}
          fresh={fresh === set.id}
          choices={choices}
          onRename={async (name) => {
            const error = answered(await api().update_set(set.id, name, null))
            if (!error) setFresh(null)
            return error
          }}
          onSongs={(titles) => void saveSongs(set, titles)}
          onDelete={() => setDeleting(set)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDeleting(null)}
          title={`Delete ${deleting.name}?`}
          description="Rehearsals played by it keep their takes and their names."
          onConfirm={() => void remove(deleting)}
        />
      )}
    </section>
  )
}

/**
 * The set picked in the list. Its name is saved on Enter or on leaving the
 * field; a name another set has is refused, and the field says why until
 * it is changed.
 */
function SetDetail({
  set,
  fresh,
  choices,
  onRename,
  onSongs,
  onDelete,
}: {
  set: SongSet
  fresh: boolean
  choices: SongChoices | null
  /** The error, or null once saved. */
  onRename: (name: string) => Promise<string | null>
  onSongs: (titles: string[]) => void
  onDelete: () => void
}) {
  const [name, setName] = useState(set.name)
  const [error, setError] = useState<string | null>(null)
  // The name last saved: Enter saves and leaves the field, and leaving it
  // would save the same name again before the list has it.
  const saved = useRef(set.name)

  const save = async () => {
    const typed = name.trim()
    if (typed === set.name || typed === saved.current) {
      setName(typed || set.name)
      return true
    }
    const refused = await onRename(typed)
    setError(refused)
    if (refused === null) {
      saved.current = typed
      setName(typed)
    }
    return refused === null
  }

  return (
    <div
      data-set-detail
      className="flex min-w-0 flex-col gap-5 rounded-xl border bg-card p-5"
    >
      <div className="flex flex-col gap-2">
        {/* What is wrong with the name is said beside it, a row no taller
            than the label's, so the songs under it never move. */}
        <div className="flex h-3.5 min-w-0 items-center gap-2">
          <Label htmlFor="set-name" className="shrink-0">
            Name
          </Label>
          {error && (
            <p title={error} className="min-w-0 truncate text-sm text-destructive">
              · {error}
            </p>
          )}
        </div>
        <Input
          id="set-name"
          value={name}
          maxLength={40}
          autoFocus={fresh}
          onFocus={(e) => fresh && e.currentTarget.select()}
          aria-invalid={error !== null}
          onChange={(e) => {
            setName(e.target.value)
            setError(null)
          }}
          onKeyDown={async (e) => {
            if (e.key !== "Enter") return
            e.preventDefault()
            const field = e.currentTarget
            if (await save()) field.blur()
          }}
          onBlur={() => void save()}
          className="max-w-sm"
        />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Songs, in the order you play them</span>
        <SetSongsEditor songs={set.songs} choices={choices} onChange={onSongs} />
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onDelete}
        className="self-start text-muted-foreground hover:text-destructive"
      >
        <Trash2 />
        Delete set
      </Button>
    </div>
  )
}
