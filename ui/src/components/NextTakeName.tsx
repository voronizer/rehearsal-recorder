import { useState } from "react"
import { Pencil } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { SongChip, SongChips } from "@/components/SongChips"
import { useSongChoices } from "@/hooks/useSongChoices"
import type { SongChoice } from "@/lib/api"

/** How many songs the row shows besides the next take's own name: the
 *  likeliest, and Other… has the rest. */
const SHOWN = 6

/**
 * What the next take will be called, over the Record button, with the songs
 * it could be instead laid out beside it: when the band moves on to another
 * song, one click says so before they play. Without it the new song's first
 * take came out as another go at the old one — "Polyn 4" for what was
 * Vesna — and was retyped after, on the review screen, while the recording
 * screen compared it with Polyn's length.
 *
 * The songs are out in the open rather than behind a menu: a menu under
 * "Next take: Take 1" read as a caption, and nobody found it. First the
 * name the take has now, lit; then what this rehearsal played, as the next
 * go at each; then the rest of the repertoire, the latest played first.
 * Other… has every song and a field for a name nobody has played.
 *
 * Python keeps the choice until a take is kept, so a take thrown away
 * leaves it for the go after.
 */
export function NextTakeName({
  name,
  version,
  onChoose,
}: {
  name: string
  /** Changes with the rehearsal's takes, so the songs follow them. */
  version: string
  onChoose: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(name)
  const choices = useSongChoices(true, null, null, version)

  const choose = (chosen: string) => {
    const trimmed = chosen.trim()
    if (trimmed && trimmed !== name) onChoose(trimmed)
    setOpen(false)
  }

  const all = choices ? [...choices.here, ...choices.other] : []
  const said = name.trim().toLocaleLowerCase()
  const itsOwn = all.find((c) => c.name.toLocaleLowerCase() === said)
  // The name the take has now, whether or not it is one of the songs: the
  // app's own "Take 1" before anything is named, or a name typed in Other….
  const current: SongChoice = itsOwn ?? { song: name, name }
  const others = all.filter((c) => c !== itsOwn).slice(0, SHOWN)
  const chip = "px-3 py-1 text-sm"

  return (
    <div
      role="group"
      aria-label="Next take"
      className="flex max-w-3xl flex-wrap items-center justify-center gap-1.5"
    >
      <span className="mr-1 text-sm text-muted-foreground">Next take:</span>
      <SongChip choice={current} current onPick={choose} className={chip} />
      {others.map((c) => (
        <SongChip key={c.song} choice={c} current={false} onPick={choose} className={chip} />
      ))}
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) setValue(name)
          setOpen(next)
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Another name for the next take"
            className="flex items-center gap-1.5 rounded-full border border-dashed px-3 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <Pencil className="size-3" />
            Other…
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="center" className="flex w-96 flex-col gap-3 p-3">
          <Input
            aria-label="Name of the next take"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                choose(value)
              }
            }}
            placeholder="A song title"
          />
          <SongChips choices={choices} value={value} initial={name} onPick={choose} />
        </PopoverContent>
      </Popover>
    </div>
  )
}
