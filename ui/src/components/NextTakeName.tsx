import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { SongChips } from "@/components/SongChips"
import { useSongChoices } from "@/hooks/useSongChoices"

/**
 * What the next take will be called, over the Record button, and a way to
 * say before playing that the band has moved on to another song. Without
 * it the new song's first take came out as another go at the old one —
 * "Polyn 4" for what was Vesna — and was retyped after, on the review
 * screen; the recording screen meanwhile compared it with Polyn's length.
 *
 * A song picked here is taken at once, since picking is all there is to
 * do; a name typed is taken with Enter. Python keeps it until a take is
 * kept, so a take thrown away leaves it for the go after.
 */
export function NextTakeName({
  name,
  onChoose,
}: {
  name: string
  onChoose: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(name)
  const choices = useSongChoices(open)

  const choose = (chosen: string) => {
    const trimmed = chosen.trim()
    if (trimmed && trimmed !== name) onChoose(trimmed)
    setOpen(false)
  }

  return (
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
          aria-label={`Next take: ${name}. Change`}
          className="flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Next take:
          <span className="truncate font-semibold text-foreground">{name}</span>
          <ChevronDown className="size-3.5 shrink-0" />
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
  )
}
