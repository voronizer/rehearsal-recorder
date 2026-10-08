import { useRef, useState } from "react"
import { X } from "lucide-react"
import { SongPills } from "@/components/SongPills"
import type { SongChoices } from "@/lib/api"
import { goFor, songFor, songNamed } from "@/lib/goes"
import { forgetSongName } from "@/lib/songNames"
import { cn } from "@/lib/utils"

/** The choices with one old name taken out of them: forgotten, until
 *  Python's fresh list arrives. */
function without(choices: SongChoices | null, name: string): SongChoices | null {
  if (!choices) return null
  const key = name.toLocaleLowerCase()
  const strip = (c: SongChoices["here"][number]) => ({
    ...c,
    also: c.also?.filter((a) => a.toLocaleLowerCase() !== key),
  })
  return { here: choices.here.map(strip), other: choices.other.map(strip) }
}

/**
 * A take's name, in one field: over Record before the take, over Save take
 * after it, and in the Rename take dialog. Naming the take is what is most
 * easily forgotten at a rehearsal, so it is big, and it is in the same
 * place before recording and after.
 *
 * It shows `value`, the name as settled, except while somebody types in
 * it. The name settled on goes to `onCommit`: a song clicked under it, ✕,
 * Enter, or focus leaving it. Never empty: ✕ and an emptied field both put
 * back `fallback`, the name the take would have anyway.
 *
 * The songs narrow from what the field held when focus arrived, not from
 * `value` itself — so coming back to a name already settled on, without
 * retyping it, still has every song under it — and while the field has
 * focus, the songs area is held at the height it had then, so the list
 * emptying out as it narrows, and filling again once the name is left or
 * put back, moves neither the field nor the buttons beside it.
 *
 * Space types a space and Escape leaves the field (useSpacebar.ts does both
 * for any text field); Enter leaves it too, so the next Space does what the
 * main button says — or, given `onEnter`, does that instead. A song or ✕
 * clicked while typing leaves it as well, for the same Space; given
 * `onEnter`, the field keeps focus instead, so Enter is still there to press.
 *
 * A song's old name in it (SongChoice.also), with or without a number, is
 * that song (rename-and-merge-songs spec, D6 and D8): the field says
 * "Palyn → Pałyn 12", and under the songs, "Palyn is Pałyn now. Make Palyn
 * a new song", which forgets the old name and puts it in the field. Not only
 * while typing: Rename take keeps what was typed until Rename is pressed.
 */
export function TakeNameField({
  id,
  label,
  value,
  fallback,
  choices,
  knownGo,
  onCommit,
  onEnter,
  size = "big",
  autoFocus = false,
  onPanel = false,
  goes = true,
  offerNewSong = true,
  onDraft,
}: {
  id: string
  label: string
  value: string
  fallback: string
  choices: SongChoices | null
  /** The go Python has for `value`, drawn until `choices` arrive; not while
   *  the field is being typed in, when it no longer says anything. */
  knownGo?: number | null
  onCommit: (name: string) => void
  onEnter?: (name: string) => void
  size?: "big" | "compact"
  autoFocus?: boolean
  /** Set on the rehearsal screen's panel colour, where the muted field
   *  would sink into it: the field is drawn on the card colour instead. */
  onPanel?: boolean
  /** False for a song's title (Rename song): no go beside it or the songs. */
  goes?: boolean
  /** False where an old name typed is not a take being named: no "Make
   *  Palyn a new song". */
  offerNewSong?: boolean
  /** What is typed, as it is typed; null once the field is left. */
  onDraft?: (text: string | null) => void
}) {
  // What is typed, while the field has focus; null shows `value`.
  const [draft, setDraft] = useState<string | null>(null)
  // The same, for onBlur to read. A song clicked while typing leaves the
  // field from inside its own click, before React has drawn anything new,
  // and `shown` there would still be the half-typed name.
  const typed = useRef<string | null>(null)
  // What the field held when focus arrived: the songs narrow from this, not
  // from `value`, so refocusing a name already settled on does not narrow
  // it by itself.
  const [startedAs, setStartedAs] = useState<string | null>(null)
  // The songs area's height when focus arrived, held while the field has
  // focus so narrowing to nothing and back does not move anything beside it.
  const [held, setHeld] = useState<number | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const songsArea = useRef<HTMLDivElement>(null)
  // An old name forgotten here, and the choices it was forgotten from: it
  // is taken out of them until Python's fresh list replaces them.
  const [forgot, setForgot] = useState<{ name: string; from: SongChoices | null } | null>(null)
  const known = forgot && forgot.from === choices ? without(choices, forgot.name) : choices
  const shown = draft ?? value
  const go = !goes
    ? null
    : known === null && draft === null && knownGo !== undefined
      ? knownGo
      : goFor(shown, known)
  // The song an old name in the field is now. A title is taken whole: in
  // Rename song, "Palyn 5" is a title of its own, not Palyn.
  const via = goes ? songFor(shown, known) : songNamed(shown, known)
  const old = via?.old != null ? { name: via.old, song: via.choice.song } : null
  const named = (text: string) => text.trim() || fallback
  const edit = (text: string | null) => {
    typed.current = text
    setDraft(text)
    onDraft?.(text)
  }

  const commit = (name: string) => {
    if (name !== value) onCommit(name)
  }
  // A song or ✕ while typing: the field is left, so the next Space records
  // or saves rather than typing a space. What was typed is dropped first, so
  // onBlur, which runs inside blur(), finds nothing of it to send. Given
  // `onEnter`, the name goes into the field and stays there to type on;
  // `startedAs` moves with it, so a fallback that is not itself a song (e.g.
  // "Take 4") does not narrow the pills by its own text until the field is
  // left and refocused.
  const put = (name: string) => {
    if (typed.current === null) {
      commit(name)
    } else if (onEnter) {
      edit(name)
      setStartedAs(name)
      commit(name)
    } else {
      typed.current = null
      commit(name)
      input.current?.blur()
    }
  }

  return (
    <div role="group" aria-label={label} className="flex min-w-0 flex-col gap-2">
      <label
        htmlFor={id}
        className={cn(
          "font-semibold text-muted-foreground",
          size === "big" ? "text-[11px] tracking-wider uppercase" : "text-xs"
        )}
      >
        {label}
      </label>
      <div
        className={cn(
          "relative w-full max-w-md rounded-lg border border-input",
          onPanel ? "bg-card" : "bg-muted/45",
          "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50"
        )}
      >
        {/* The go this name will be, after the text: drawn over the field,
            behind an invisible copy of the text, so it sits where the text
            ends. It is never part of the name, so it cannot be selected or
            typed over (songs in the store, D2). */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 flex items-center overflow-hidden pr-11 pl-3.5 font-semibold whitespace-pre",
            size === "big" ? "text-[1.75rem] leading-9" : "text-base"
          )}
        >
          <span className="invisible">{shown}</span>
          {old ? (
            <span data-take-go className="tnum text-muted-foreground">
              {" → "}
              {old.song}
              {go !== null && ` ${go}`}
            </span>
          ) : (
            go !== null && (
              <span data-take-go className="tnum text-muted-foreground">
                {" "}
                {go}
              </span>
            )
          )}
        </div>
        <span id={`${id}-go`} className="sr-only">
          {old ? `${old.song}${go !== null ? `, go ${go}` : ""}` : go !== null ? `Go ${go}` : ""}
        </span>
        <input
          id={id}
          aria-describedby={`${id}-go`}
          ref={input}
          value={shown}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          onFocus={() => {
            edit(value)
            setStartedAs(value)
            setHeld(songsArea.current?.offsetHeight ?? null)
          }}
          onChange={(e) => edit(e.target.value)}
          onBlur={() => {
            const left = typed.current
            edit(null)
            setStartedAs(null)
            setHeld(null)
            if (left !== null) commit(named(left))
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return
            e.preventDefault()
            if (onEnter) onEnter(named(shown))
            else input.current?.blur()
          }}
          className={cn(
            "w-full bg-transparent pr-11 pl-3.5 font-semibold outline-none",
            size === "big" ? "py-1.5 text-[1.75rem] leading-9" : "h-9 text-base"
          )}
        />
        <button
          type="button"
          aria-label={`Put back “${fallback}”`}
          // Takes no focus of its own, as the songs take none: `put` says
          // whether the field keeps it.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => put(fallback)}
          className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <div ref={songsArea} style={{ minHeight: held ?? undefined }}>
        <SongPills
          choices={known}
          value={shown}
          initial={startedAs ?? shown}
          onPick={put}
          goes={goes}
        />
        {old && offerNewSong && (
          <p data-old-name className="mt-2 text-xs text-muted-foreground">
            {old.name} is {old.song} now.{" "}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={async () => {
                // What was typed, less a number after it: the go is the app's.
                const text = songNamed(shown, known)
                  ? shown.trim()
                  : shown.trim().replace(/\s+\d+$/, "")
                const from = choices
                await forgetSongName(old.name)
                setForgot({ name: old.name, from })
                put(text)
              }}
              className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
            >
              Make {old.name} a new song
            </button>
          </p>
        )}
      </div>
    </div>
  )
}
