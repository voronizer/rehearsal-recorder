import { useRef, useState } from "react"
import { X } from "lucide-react"
import { SongPills } from "@/components/SongPills"
import type { SongChoices } from "@/lib/api"
import { cn } from "@/lib/utils"

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
 * main button says — or, given `onEnter`, does that instead.
 */
export function TakeNameField({
  id,
  label,
  value,
  fallback,
  choices,
  onCommit,
  onEnter,
  size = "big",
  autoFocus = false,
}: {
  id: string
  label: string
  value: string
  fallback: string
  choices: SongChoices | null
  onCommit: (name: string) => void
  onEnter?: (name: string) => void
  size?: "big" | "compact"
  autoFocus?: boolean
}) {
  // What is typed, while the field has focus; null shows `value`.
  const [draft, setDraft] = useState<string | null>(null)
  // What the field held when focus arrived: the songs narrow from this, not
  // from `value`, so refocusing a name already settled on does not narrow
  // it by itself.
  const [startedAs, setStartedAs] = useState<string | null>(null)
  // The songs area's height when focus arrived, held while the field has
  // focus so narrowing to nothing and back does not move anything beside it.
  const [held, setHeld] = useState<number | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const songsArea = useRef<HTMLDivElement>(null)
  const shown = draft ?? value
  const named = (typed: string) => typed.trim() || fallback

  const commit = (name: string) => {
    if (name !== value) onCommit(name)
  }
  // A song or ✕ while typing goes into the field and stays there to type on.
  const put = (name: string) => {
    if (draft !== null) setDraft(name)
    commit(name)
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
          "relative w-full max-w-md rounded-lg border border-input bg-muted/45",
          "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50"
        )}
      >
        <input
          id={id}
          ref={input}
          value={shown}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          onFocus={() => {
            setDraft(value)
            setStartedAs(value)
            setHeld(songsArea.current?.offsetHeight ?? null)
          }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setDraft(null)
            setStartedAs(null)
            setHeld(null)
            commit(named(shown))
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
          // Leaves focus where it was, as the songs do.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => put(fallback)}
          className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <div ref={songsArea} style={{ minHeight: held ?? undefined }}>
        <SongPills choices={choices} value={shown} initial={startedAs ?? shown} onPick={put} />
      </div>
    </div>
  )
}
