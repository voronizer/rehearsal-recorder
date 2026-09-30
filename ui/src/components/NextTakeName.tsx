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
 * "Next take: Take 1" read as a caption, and nobody found it. They are what
 * this rehearsal played, as the next go at each, then the rest of the
 * repertoire, the latest played first; Other… has every song and a field
 * for a name nobody has played.
 *
 * The one picked is lit where it stands. Nothing moves when one is
 * clicked: with the picked one put first, the song clicked jumped out from
 * under the pointer and the rest shifted along. So the name the take would
 * have anyway, "Take 1" before anything is named, leads the row while it
 * is no song's, and stays there to go back to; a name from Other… that the
 * row has no place for comes last.
 *
 * Python keeps the choice until a take is kept, so a take thrown away
 * leaves it for the go after.
 */
export function NextTakeName({
  name,
  defaultName,
  version,
  onChoose,
}: {
  name: string
  /** What it would be called without a name picked for it. */
  defaultName: string
  /** Changes with the rehearsal's takes, so the songs follow them. */
  version: string
  /** The name picked, or "" to go back to the default. */
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

  const songs = choices ? [...choices.here, ...choices.other] : []
  const same = (a: string, b: string) =>
    a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()
  const lead: SongChoice | null = songs.some((c) => same(c.name, defaultName))
    ? null
    : { song: defaultName, name: defaultName }
  const shown = songs.slice(0, SHOWN)
  const placed = [...(lead ? [lead] : []), ...shown]
  const last: SongChoice | null = placed.some((c) => same(c.name, name))
    ? null
    : (songs.find((c) => same(c.name, name)) ?? { song: name, name })
  const row = [...placed, ...(last ? [last] : [])]
  const pick = (c: SongChoice) => {
    // The lead goes back to the name the take would have had, picked or not.
    if (c === lead) {
      if (!same(name, defaultName)) onChoose("")
    } else choose(c.name)
  }
  const chip = "px-3 py-1 text-sm"

  return (
    <div
      role="group"
      aria-label="Next take"
      className="flex max-w-3xl flex-wrap items-center justify-center gap-1.5"
    >
      <span className="mr-1 text-sm text-muted-foreground">Next take:</span>
      {row.map((c) => (
        <SongChip
          key={c.song}
          choice={c}
          current={same(c.name, name)}
          onPick={() => pick(c)}
          className={chip}
        />
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
