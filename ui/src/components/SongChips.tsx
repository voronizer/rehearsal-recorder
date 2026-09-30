import type { SongChoice, SongChoices } from "@/lib/api"
import { cn } from "@/lib/utils"

/** How many of the other rehearsals' songs show at once: the latest played,
 *  and typing finds the rest. */
const OTHERS_SHOWN = 10

/**
 * The songs already played, under a take's name, so that naming one is a
 * click and not the title typed out again: this rehearsal's first, then
 * the rest of the repertoire. Each is the name it gives — "Polyn 3" where
 * Polyn has had two goes here — with the number dimmed.
 *
 * What was typed narrows them. The name the field started with, or one of
 * theirs just picked, does not: every song stays there to switch to.
 *
 * A click leaves focus where it was, so Enter in a dialog's field still
 * confirms, and Space on the review screen still saves.
 */
export function SongChips({
  choices,
  value,
  initial,
  onPick,
  className,
}: {
  choices: SongChoices | null
  value: string
  /** What the field held to begin with. */
  initial: string
  onPick: (name: string) => void
  className?: string
}) {
  if (!choices) return null
  const typed = value.trim().toLocaleLowerCase()
  const isChoice = (c: SongChoice) => c.name.toLocaleLowerCase() === typed
  const narrowing =
    typed !== "" &&
    value.trim() !== initial.trim() &&
    ![...choices.here, ...choices.other].some(isChoice)
  const fits = (c: SongChoice) =>
    !narrowing || c.song.toLocaleLowerCase().includes(typed)
  const here = choices.here.filter(fits)
  const other = choices.other.filter(fits).slice(0, OTHERS_SHOWN)
  if (here.length === 0 && other.length === 0) return null

  const row = (title: string, items: SongChoice[]) => (
    <div role="group" aria-label={title} className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {items.map((c) => (
          <SongChip key={c.song} choice={c} current={isChoice(c)} onPick={onPick} />
        ))}
      </div>
    </div>
  )

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {here.length > 0 && row("This rehearsal", here)}
      {other.length > 0 && row(here.length > 0 ? "Other songs" : "Songs", other)}
    </div>
  )
}

/**
 * One song to name a take after, as the name it gives: "Polyn 3", with the
 * number dimmed. Pressing it does not take focus, so the keys stay where
 * they were — in the field being named, or with the screen.
 */
export function SongChip({
  choice: c,
  current,
  onPick,
  className,
}: {
  choice: SongChoice
  current: boolean
  onPick: (name: string) => void
  className?: string
}) {
  return (
    <button
      type="button"
      data-song-choice={c.name}
      aria-current={current ? "true" : undefined}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onPick(c.name)}
      className={cn(
        "max-w-full truncate rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        "hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
        current && "border-primary bg-primary/15 hover:bg-primary/20",
        className
      )}
    >
      {c.song}
      {c.name !== c.song && (
        <span className="text-muted-foreground">{c.name.slice(c.song.length)}</span>
      )}
    </button>
  )
}
